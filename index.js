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
    const filePath = core.getInput("filepath") || "../../fake-file.ps1";
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
    const zipFileLocation = "dist/CodeSignTool.zip";

    const extractEntryTo = `./`;
    const outputDir = `./`;

    core.info("Downloading zip...");
    request
      .get("https://www.ssl.com/download/codesigntool-for-windows/")
      .on("error", function (error) {
        core.error(error);
        core.setFailed(error.message);
        return;
      })
      .pipe(fs.createWriteStream(__dirname + "/" + zipFile))
      .on("finish", function () {
        core.info("finished downloading zip");
        var zip = new admZip(__dirname + "/" + zipFile);
        core.info("start unzip");
        zip.extractAllTo(__dirname + "/", true);
        core.info("finished unzip");
        let foundUnzipped = fs
          .readdirSync(__dirname + "/")
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

        exec("pwd", function (err, stdout, stderr) {
          core.info("PWD:  " + stdout);
          const pwd = stdout.trim();
          core.error(stderr);

          core.info(
            "CODE_SIGN_TOOL_PATH-before: \t" + process.env.CODE_SIGN_TOOL_PATH
          );
          process.env.CODE_SIGN_TOOL_PATH = `${__dirname}\\${folder}`;
          core.info(
            "CODE_SIGN_TOOL_PATH-after: \t" + process.env.CODE_SIGN_TOOL_PATH
          );

          core.info("__dirname: \t" + __dirname);
          exec(`ls ${__dirname}`, function (err, stdout, stderr) {
            core.info(`------ls ${__dirname}---   ` + stdout);
          });

          if (isTest) {
            core.info("\tRUNNING TEST");

            wait(2000);

            const content = `CLIENT_ID=${sslClientId}\nOAUTH2_ENDPOINT=https://oauth-sandbox.ssl.com/oauth2/token\nCSC_API_ENDPOINT=https://cs-try.ssl.com\nTSA_URL=http://ts.ssl.com`;
            exec(
              `ls ${process.env.CODE_SIGN_TOOL_PATH}/conf`,
              function (err, stdout, stderr) {
                core.info(
                  `------ls ${process.env.CODE_SIGN_TOOL_PATH}/conf---   ` +
                    stdout
                );
              }
            );

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
            core.info(
              `EXEC: \t --  ${process.env.CODE_SIGN_TOOL_PATH}/CodeSignTool.bat sign -username='esigner_demo' -password='esignerDemo#1' -totp_secret='RDXYgV9qju+6/7GnMf1vCbKexXVJmUVr+86Wq/8aIGg=' -input_file_path="${filePath}" -override`
            );
            exec(
              `${process.env.CODE_SIGN_TOOL_PATH}/CodeSignTool.bat sign -username='esigner_demo' -password='esignerDemo#1' -totp_secret='RDXYgV9qju+6/7GnMf1vCbKexXVJmUVr+86Wq/8aIGg=' -input_file_path="${filePath}" -override`,
              function (err, stdout, stderr) {
                if (err || stderr) {
                  core.error(stderr);
                  core.error(err);
                  core.setFailed(stderr);
                  return;
                }
                // Done.
                core.info("\tDone SIGNING");
                if (stdout.includes("Error")) {
                  core.error(stdout);
                  core.setFailed(stdout);
                } else {
                  core.info(stdout);
                }

                // const files = fs.readdirSync(`./${folder}/ssl-output`);
                // core.info(`SSL-OUTPUT: ${files}`);

                // files.forEach((file) => {
                //   core.info(__dirname + `/${folder}/ssl-output/` + file);
                //   core.info(path.join(__dirname + file));

                //   fs.copyFile(
                //     path.join(__dirname + `/${folder}/ssl-output/` + file),
                //     path.join(__dirname + "/" + `${file}.signed`),
                //     (err) => {
                //       if (!err) {
                //         core.info(file + " has been copied!");
                //       } else {
                //         core.error(`COPY FAILED`);
                //         core.error(err);

                //         core.setFailed(error.message);
                //       }
                //     }
                //   );
                // });
              }
            );
          } else {
            core.info("\tRUNNING REAL USE CASE");
          }
        });

        // if (!fs.existsSync(`./dist/${folder}/ssl-output`)) {
        //   fs.mkdirSync(`./dist/${folder}/ssl-output`);
        // }
      });
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
