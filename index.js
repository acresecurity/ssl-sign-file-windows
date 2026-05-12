const core = require("@actions/core");
const wait = require("./wait");
const admZip = require("adm-zip");
const request = require("superagent");
const fs = require("fs");
const fsAsync = require("fs/promises");
const path = require("path");
const assert = require("assert");
let exec = require("child_process").exec;
let execFile = require("child_process").execFile;

function fail(errorOrMessage) {
  core.error(errorOrMessage);
  core.setFailed(errorOrMessage);
}

/**
 * Unpacks the CodeSign tool from `${targetDir}/${zipFileName}`.
 * @param {string} targetDir - the parent directory of the zip file.
 * @param {string} zipFileName - name of the zip file to unpack.
 */
async function unpackCodesign(targetDir, zipFileName) {
  core.info(`---Unpacking ${zipFileName}...`);
  const zip = new admZip(path.join(targetDir, zipFileName));
  zip.extractAllTo(targetDir, true);
  core.info("---Finished unpacking.");
}

/**
 * Finds the code sign tool's batch script.
 * @param {string} targetDir - the directory to search.
 */
async function findCodesign(targetDir) {
  const filesInDirectory = await fsAsync.readdir(targetDir);
  const batFiles = filesInDirectory.filter((fn) =>
    fn.startsWith("CodeSignTool.bat"),
  );
  return batFiles.length > 0 ? batFiles[0] : null;
}

/**
 * Signs the given file.
 * @param {string} codeSignPath - the directory housing CodeSign files.
 * @param {string} targetFile - the file to sign.
 * @param {boolean} isTest - whether this is a test run.
 * @param {object} sslCredentials - credentials for SSL signing. Overridden during tests.
 * @param {string} sslCredentials.username
 * @param {string} sslCredentials.password
 * @param {string} sslCredentials.totpSecret
 * @param {string} sslCredentials.clientId
 */
async function sign(codeSignPath, targetFile, isTest, sslCredentials) {
  process.env.CODE_SIGN_TOOL_PATH = codeSignPath;

  await saveProperties(sslCredentials.clientId, isTest);
  let message = "Running real use case!";
  if (isTest) {
    message = "Running test!";

    sslCredentials.username = "esigner_demo";
    sslCredentials.password = "esignerDemo#1";
    sslCredentials.totpSecret = "RDXYgV9qju+6/7GnMf1vCbKexXVJmUVr+86Wq/8aIGg=";
  }

  core.info(message);
  execFile(
    path.join(process.env.CODE_SIGN_TOOL_PATH, "CodeSignTool.bat"),
    [
      "sign",
      `-username='${sslCredentials.username}'`,
      `-password='${sslCredentials.password}'`,
      `-totp_secret='${sslCredentials.totpSecret}'`,
      `-input_file_path='${targetFile}'`,
      "-override",
    ],
    (error, stdout, stderr) => {},
  );
}

/**
 * @param {string} sslClientId
 * @param {boolean} isTest
 */
async function saveProperties(sslClientId, isTest) {
  assert(
    process.env.CODE_SIGN_TOOL_PATH,
    "`process.env.CODE_SIGN_TOOL_PATH` must be defined!",
  );
  const properties = {
    CLIENT_ID: sslCredentials.clientId,
    OAUTH2_ENDPOINT: "https://login.ssl.com/oauth2/token",
    CSC_API_ENDPOINT: "https://cs.ssl.com",
    TSA_URL: "https://ts.ssl.com",
  };

  if (isTest) {
    properties.OAUTH2_ENDPOINT = "https://oauth-sandbox.ssl.com/oauth2/token";
    properties.CSC_API_ENDPOINT = "https://cs-try.ssl.com";
  }

  // This creates content of the format:
  // KEY1=VALUE1
  // KEY2=VALUE2
  // (etc.)
  const content = Object.entries()
    .map(([key, value]) => {
      return `${key}=${value}`;
    })
    .join("\n");

  try {
    await fsAsync.writeFile(
      path.join(
        process.env.CODE_SIGN_TOOL_PATH,
        "conf",
        "code_sign_tool.properties",
      ),
      content,
      { encoding: "utf8", flag: "w" },
    );
  } catch (err) {
    fail(err);
    return;
  }
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
      `Running windows sign action as test: [${isTest}] for [${filePath}] ...`,
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
        // Done downloading
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
            core.error("Could not find unzipped CodeSignTool OR bat file");
            core.setFailed(error.message);
            return;
          }
        }
        const folder = foundUnzipped ? foundUnzipped[0] : "";
        core.info(
          `---Using unzipped folder or bat: [${foundUnzipped ? folder : foundBat[0]}]`,
        );

        exec("pwd", function (err, stdout, stderr) {
          core.info("--PWD:  " + stdout);
          const pwd = stdout.trim();

          core.info(
            "CODE_SIGN_TOOL_PATH-before: \t" + process.env.CODE_SIGN_TOOL_PATH,
          );
          process.env.CODE_SIGN_TOOL_PATH = foundUnzipped
            ? `${__dirname}\\${folder}`
            : `${__dirname}`;
          core.info(
            "CODE_SIGN_TOOL_PATH-after: \t" + process.env.CODE_SIGN_TOOL_PATH,
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
              { encoding: "utf8", flag: "w" },
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
            },
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
