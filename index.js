const core = require("@actions/core");
const wait = require("./wait");
const admZip = require("adm-zip");
const request = require("superagent");
const fs = require("fs");
const path = require("path");
let exec = require("child_process").exec;

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
        if (!foundUnzipped || foundUnzipped.length == 0) {
          core.error("Could not find unzipped CodeSignTool");
          core.setFailed(error.message);
          return;
        }
        const folder = foundUnzipped[0];
        core.info(`---Using unzipped folder: [${folder}]`);

        exec("pwd", function (err, stdout, stderr) {
          core.info("--PWD:  " + stdout);
          const pwd = stdout.trim();

          core.info(
            "CODE_SIGN_TOOL_PATH-before: \t" + process.env.CODE_SIGN_TOOL_PATH
          );
          process.env.CODE_SIGN_TOOL_PATH = `${__dirname}\\${folder}`;
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
          core.info(`---Executing SIGN Action`);
          exec(
            isTest
              ? `${process.env.CODE_SIGN_TOOL_PATH}/CodeSignTool.bat sign -username='esigner_demo' -password='esignerDemo#1' -totp_secret='RDXYgV9qju+6/7GnMf1vCbKexXVJmUVr+86Wq/8aIGg=' -input_file_path="${filePath}" -override`
              : `${process.env.CODE_SIGN_TOOL_PATH}/CodeSignTool.bat sign -username="${sslUsername}" -password="${sslPassword}" -totp_secret="${sslSecretPassword}" -input_file_path="${filePath}" -override`,
            function (err, stdout, stderr) {
              if (err || stderr) {
                core.error(stderr);
                core.error(err);
                core.setFailed(stderr);
                return;
              }
              // Done.
              core.info("---Done SIGNING, check for error");
              if (stdout.includes("Error")) {
                core.error(stdout);
                core.setFailed(stdout);
                return;
              } else {
                core.info(stdout);
                core.info("---SUCCESS");
              }
            }
          );
        });
      });
  } catch (error) {
    core.info(error);
    core.setFailed(error.message);
    return;
  }
}

run();
