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
      .pipe(fs.createWriteStream(zipFile))
      .on("finish", function () {
        core.info("finished downloading zip");
        var zip = new admZip(zipFile);
        core.info("start unzip");
        zip.extractAllTo("./dist/", true);
        core.info("finished unzip");
        let foundUnzipped = fs
          .readdirSync("./dist/")
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
            "CODE_SIGN_TOOL_PATH: \t" + process.env.CODE_SIGN_TOOL_PATH
          );
          process.env.CODE_SIGN_TOOL_PATH = `${pwd}/dist/${folder}`;
          core.info(
            "CODE_SIGN_TOOL_PATH: \t" + process.env.CODE_SIGN_TOOL_PATH
          );

          core.info("__dirname: \t" + __dirname);
          exec(`ls ${__dirname}`, function (err, stdout, stderr) {
            core.info(`------ls ${__dirname}---   ` + stdout);
          });

          if (isTest) {
            core.info("\tRUNNING TEST");

            exec(`ls ${pwd}`, function (err, stdout, stderr) {
              core.info(`------ls ${pwd}---   ` + stdout);
            });

            exec(`ls ${pwd}/dist`, function (err, stdout, stderr) {
              core.info(`------ls ${pwd}/dist---   ` + stdout);
            });

            exec(`ls ${pwd}/dist/${folder}`, function (err, stdout, stderr) {
              core.info(
                `------ls ${pwd}/dist/CodeSignTool-v1.2.7-windows---   ` +
                  stdout
              );
            });

            exec(
              `ls ${pwd}/dist/${folder}/conf/`,
              function (err, stdout, stderr) {
                core.info(
                  `------ls ${pwd}/dist/CodeSignTool-v1.2.7-windows/conf---   ` +
                    stdout
                );
              }
            );

            wait(2000);

            const content = `CLIENT_ID=${sslClientId}\nOAUTH2_ENDPOINT=https://oauth-sandbox.ssl.com/oauth2/token\nCSC_API_ENDPOINT=https://cs-try.ssl.com\nTSA_URL=http://ts.ssl.com`;
            var confLocation2 = path.join(
              process.env.CODE_SIGN_TOOL_PATH,
              "conf",
              "code_sign_tool.properties"
            );
            core.info("confLocation2: " + confLocation2);
            exec(
              `ls ${__dirname}\\${folder}\\conf`,
              function (err, stdout, stderr) {
                core.info(
                  `------ls ${__dirname}\\${folder}\\conf---   ` + stdout
                );
              }
            );

            try {
              fs.writeFileSync(
                `${__dirname}\\${folder}\\conf\\code_sign_tool.properties`,
                content,
                { encoding: "utf8", flag: "w" }
              );
              // file written successfully
            } catch (err) {
              core.error(err);
              core.setFailed(err);
              return;
            }

            exec(
              path.join(
                process.env.CODE_SIGN_TOOL_PATH,
                `CodeSignTool.bat sign -username='esigner_demo' -password='esignerDemo#1' -totp_secret='RDXYgV9qju+6/7GnMf1vCbKexXVJmUVr+86Wq/8aIGg=' -input_file_path="${filePath}" -override`
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

        // if (!fs.existsSync(`./dist/${folder}/ssl-output`)) {
        //   fs.mkdirSync(`./dist/${folder}/ssl-output`);
        // }
      });
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
