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
    core.info(`START ...`);
    const filePath = core.getInput("filepath");
    const sslUsername = core.getInput("sslusername");
    const sslPassword = core.getInput("sslpassword");
    const sslSecretPassword = core.getInput("sslsecretpassword");
    const sslClientId = core.getInput("sslclientid");
    const isTest = core.getInput("istest") || true;

    core.info(
      `Running windows sign action as test: [${isTest}] for [${filePath}] ...`
    );
    core.info(`Running with sslClientId: [${sslClientId}]...`);
    const zipFile = "CodeSignTool.zip";
    const extractEntryTo = `./`;
    const outputDir = `./`;

    core.info("Downloading zip...");
    request
      .get("https://www.ssl.com/download/codesigntool-for-windows/")
      .on("error", function (error) {
        core.setFailed(error.message);
        return;
      })
      .pipe(fs.createWriteStream(zipFile))
      .on("finish", function () {
        // wait(2000);
        core.info("finished downloading zip");
        // var zip = new admZip(zipFile);
        // core.info("start unzip");
        // zip.extractEntryTo(extractEntryTo, outputDir, false, true);
        // core.info("finished unzip");

        var zip = new admZip(zipFile);
        core.info("start unzip");
        zip.extractAllTo(".", true);
        core.info("finished unzip");
        let foundUnzipped = fs
          .readdirSync("./")
          .filter((fn) => fn.startsWith("CodeSignTool-v"));
        if (!foundUnzipped || foundUnzipped.length == 0) {
          core.warning(
            "Could not find unzipped CodeSignTool, using LocalCodeSignTool"
          );
          core.info(fs.readdirSync("./"));

          var zip2 = new admZip("./LocalCodeSignTool.zip");
          zip2.extractAllTo(".", true);
          foundUnzipped = fs
            .readdirSync("./")
            .filter((fn) => fn.startsWith("CodeSignTool-v"));
        }
        const folder = foundUnzipped[0];
        core.info(`Using folder: ${folder}`);

        if (!fs.existsSync(`./${folder}/ssl-output`)) {
          fs.mkdirSync(`./${folder}/ssl-output`);
        }

        core.info("CODE_SIGN_TOOL_PATH: " + process.env.CODE_SIGN_TOOL_PATH);
        process.env.CODE_SIGN_TOOL_PATH = path.join(__dirname + `/${folder}/`);
        core.info("CODE_SIGN_TOOL_PATH: " + process.env.CODE_SIGN_TOOL_PATH);

        if (isTest) {
          core.info("\tRUNNING TEST");
          const content = `CLIENT_ID=${sslClientId}\nOAUTH2_ENDPOINT=https://oauth-sandbox.ssl.com/oauth2/token\nCSC_API_ENDPOINT=https://cs-try.ssl.com\nTSA_URL=http://ts.ssl.com`;
          core.info("CODE_SIGN_TOOL_PATH: " + process.env.CODE_SIGN_TOOL_PATH);
          var confLocation = path.join(
            __dirname + `\\${folder}\\conf\\code_sign_tool.properties`
          );
          core.info("confLocation: " + confLocation);
          var confLocation2 = path.join(
            process.env.CODE_SIGN_TOOL_PATH,
            "conf",
            "code_sign_tool.properties"
          );
          core.info("confLocation2: " + confLocation2);

          try {
            fs.writeFileSync(confLocation2, content);
            // file written successfully
          } catch (err) {
            core.error(err);
            core.setFailed(err);
            return;
          }
          const outputDir = path.join(__dirname + `/${folder}/ssl-output\\`);
          core.info("outputDir: " + outputDir);
          exec(
            "ls CodeSignTool-v1.2.7-windows/ssl-output",
            function (err, stdout, stderr) {
              core.info(stdout);
              core.error(stderr);
            }
          );
          exec(
            path.join(
              __dirname +
                `/${folder}/CodeSignTool.bat sign -username='esigner_demo' -password='esignerDemo#1' -totp_secret='RDXYgV9qju+6/7GnMf1vCbKexXVJmUVr+86Wq/8aIGg=' -input_file_path="${filePath}" -override`
            ),
            function (err, stdout, stderr) {
              if (err || stderr) {
                core.error(stderr);
                core.error(err);
                core.setFailed(stderr);
                return;
              }
              // Done.
              core.info("\tDone SIGNING");
              core.info(stdout);

              const files = fs.readdirSync(`./${folder}/ssl-output`);
              core.info(`SSL-OUTPUT: ${files}`);

              files.forEach((file) => {
                core.info(__dirname + `/${folder}/ssl-output/` + file);
                core.info(path.join(__dirname + file));

                fs.copyFile(
                  path.join(__dirname + `/${folder}/ssl-output/` + file),
                  path.join(__dirname + "/" + `${file}.signed`),
                  (err) => {
                    if (!err) {
                      core.info(file + " has been copied!");
                    } else {
                      core.error(`COPY FAILED`);
                      core.error(err);

                      core.setFailed(error.message);
                    }
                  }
                );
              });
            }
          );
        } else {
          core.info("\tRUNNING REAL USE CASE");
        }
      });
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
