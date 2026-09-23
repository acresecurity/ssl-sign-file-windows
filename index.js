const core = require("@actions/core");
const admZip = require("adm-zip");
const request = require("superagent");
const fs = require("fs");
const path = require("path");
const tls = require("tls");
const truststore = require("./truststore");
let exec = require("child_process").exec;

const EXEC_OPTIONS = { maxBuffer: 16 * 1024 * 1024 };

// Logs the served chain so the next root rotation is a ten second diagnosis. Never fails the step.
function logPeerChain(host) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };

    const socket = tls.connect({ host, port: 443, servername: host }, () => {
      const seen = [];
      let cert = socket.getPeerCertificate(true);
      while (cert && cert.fingerprint256 && seen.indexOf(cert.fingerprint256) === -1) {
        seen.push(cert.fingerprint256);
        core.info(
          `  ${host} | subject=${cert.subject && cert.subject.CN} | ` +
          `issuer=${cert.issuer && cert.issuer.CN} | expires=${cert.valid_to} | ` +
          `sha256=${cert.fingerprint256}`
        );
        cert = cert.issuerCertificate;
      }
      socket.end();
      finish();
    });

    socket.setTimeout(10000, () => {
      core.info(`  ${host} | timed out`);
      socket.destroy();
      finish();
    });
    socket.on("error", (err) => {
      core.info(`  ${host} | ${err.message}`);
      finish();
    });
  });
}

// most @actions toolkit packages have async methods
async function run() {
  try {
    core.info(`---START`);
    const filePath =
      core.getInput("filepath") ||
      path.resolve(__dirname, "..") + "\\fake-file.ps1";
    const sslUsername = core.getInput("sslusername");
    const sslPassword = core.getInput("sslpassword");
    const sslSecretPassword = core.getInput("sslsecretpassword");
    const sslClientId =
      core.getInput("sslclientid") ||
      "qOUeZCCzSqgA93acB3LYq6lBNjgZdiOxQc-KayC3UMw";
    const isTestStr = core.getInput("istest") || "true";
    const isTest = isTestStr !== "false";

    // Sandbox credentials are publicly available at https://www.ssl.com/guide/esigner-demo-credentials-and-certificates/

    core.info(
      `Running windows sign action as test: [${isTest}] for [${filePath}] ...`
    );
    const zipFile = "CodeSignTool.zip";

    core.info("---Downloading zip");
    request
      .get("https://www.ssl.com/download/codesigntool-for-windows/")
      .on("error", function (error) {
        core.error(error);
        core.setFailed(error.message);
        return;
      })
      .pipe(fs.createWriteStream(__dirname + "/" + zipFile))
      .on("finish", function () {
        core.info("---Finished downloading zip");
        var zip = new admZip(__dirname + "/" + zipFile);
        core.info("---Start unzip");
        zip.extractAllTo(__dirname + "/", true);
        core.info("---Finished unzip");
        let foundUnzipped = fs
          .readdirSync(__dirname + "/")
          .filter((fn) => fn.startsWith("CodeSignTool-v"));
        let foundBat = fs
          .readdirSync(__dirname + "/")
          .filter((fn) => fn.startsWith("CodeSignTool.bat"));
        if (!foundUnzipped || foundUnzipped.length == 0) {
          foundUnzipped = null;
          if (!foundBat || foundBat.length == 0) {
            foundBat = null;
            core.setFailed("Could not find unzipped CodeSignTool OR bat file");
            return;
          }
        }
        const folder = foundUnzipped ? foundUnzipped[0] : "";
        core.info(`---Using unzipped folder or bat: [${foundUnzipped ? folder : foundBat[0]}]`);

        exec("pwd", function (err, stdout) {
          core.info("--PWD:  " + stdout);

          core.info(
            "CODE_SIGN_TOOL_PATH-before: \t" + process.env.CODE_SIGN_TOOL_PATH
          );
          process.env.CODE_SIGN_TOOL_PATH = foundUnzipped ? `${__dirname}\\${folder}` : `${__dirname}`;
          core.info(
            "CODE_SIGN_TOOL_PATH-after: \t" + process.env.CODE_SIGN_TOOL_PATH
          );

          core.info("__dirname: \t" + __dirname);

          core.info(`\t${isTest ? "RUNNING TEST" : "RUNNING REAL USE CASE"}`);

          let content = isTest
            ? `CLIENT_ID=${sslClientId}\nOAUTH2_ENDPOINT=https://oauth-sandbox.ssl.com/oauth2/token\nCSC_API_ENDPOINT=https://cs-try.ssl.com\nTSA_URL=http://ts.ssl.com`
            : `CLIENT_ID=${sslClientId}\nOAUTH2_ENDPOINT=https://login.ssl.com/oauth2/token\nCSC_API_ENDPOINT=https://cs.ssl.com\nTSA_URL=http://ts.ssl.com`;

          core.info(`---Writing updated conf file`);
          try {
            fs.writeFileSync(
              `${process.env.CODE_SIGN_TOOL_PATH}/conf/code_sign_tool.properties`,
              content,
              { encoding: "utf8", flag: "w" }
            );
            // file written successfully
          } catch (err) {
            core.error(err);
            core.setFailed(err);
            return;
          }
          // cmd.exe does not treat ' as a quote character, so every argument needs double quotes.
          const signCommand = isTest
            ? `${process.env.CODE_SIGN_TOOL_PATH}/CodeSignTool.bat sign -username="esigner_demo" -password="esignerDemo#1" -totp_secret="RDXYgV9qju+6/7GnMf1vCbKexXVJmUVr+86Wq/8aIGg=" -input_file_path="${filePath}" -override`
            : `${process.env.CODE_SIGN_TOOL_PATH}/CodeSignTool.bat sign -username="${sslUsername}" -password="${sslPassword}" -totp_secret="${sslSecretPassword}" -input_file_path="${filePath}" -override`;

          const cscHost = isTest ? "cs-try.ssl.com" : "cs.ssl.com";
          const oauthHost = isTest ? "oauth-sandbox.ssl.com" : "login.ssl.com";

          core.info(`---Preflight: certificate chains`);
          Promise.all([logPeerChain(cscHost), logPeerChain(oauthHost)])
            .then(() => {
              core.info(`---Checking the truststore of the bundled JRE`);
              return truststore.ensureTrustedRoots(process.env.CODE_SIGN_TOOL_PATH, {
                log: (message) => core.info(`  ${message}`),
                warn: (message) => core.warning(message),
              });
            })
            .then(() => {
              core.info(`---Executing SIGN Action`);
              exec(signCommand, EXEC_OPTIONS, function (err, stdout, stderr) {
                const result = truststore.classifyExecResult({ err, stdout, stderr });
                if (!result.ok) {
                  core.error(result.output);
                  core.setFailed(`${result.reason}\n${result.output}`);
                  return;
                }
                core.info("---Done SIGNING, check for error");
                if (stderr && stderr.trim()) {
                  core.warning(stderr);
                }
                core.info(stdout);
                core.info("---SUCCESS");
              });
            })
            .catch((err) => {
              core.error(err.message);
              core.setFailed(err.message);
            });
        });
      });
  } catch (error) {
    core.info(error);
    core.setFailed(error.message);
    return;
  }
}

run();
