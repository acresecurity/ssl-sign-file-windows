const core = require('@actions/core');
const wait = require('./wait');
const admZip = require('adm-zip');
const request = require('superagent');
const fs = require('fs');
const path = require('path');
let exec = require('child_process').exec


// most @actions toolkit packages have async methods
async function run() {
  try {
    core.info(`START ...`);
    // const filePath = core.getInput('filepath');
    // const sslUsername = core.getInput('sslusername');
    // const sslPassword = core.getInput('sslpassword');
    // const sslSecretPassword = core.getInput('sslsecretpassword');
    // const sslClientId = core.getInput('sslclientid');
    const isTest = core.getInput('istest');

    // core.info(`Running windows sign action as test: ${isTest} for ${filepath} ...`);
    const zipFile = 'CodeSignTool.zip';
    const extractEntryTo = `./`;
    const outputDir = `./`;

    core.info('Downloading zip...');
    // request
    //   .get("https://www.ssl.com/download/codesigntool-for-windows/")
    //   .on('error', function (error) {
    //     core.setFailed(error.message);
    //   })
    //   .pipe(fs.createWriteStream(zipFile))
    //   .on('finish', function () {
    //     core.info('finished downloading zip');
    //     var zip = new admZip(zipFile);
    //     core.info('start unzip');
    //     zip.extractEntryTo(extractEntryTo, outputDir, false, true);
    //     core.info('finished unzip');
    //     core.info((new Date()).toTimeString());

    //     core.setOutput('time', new Date().toTimeString());
    //   });

    // var zip = new admZip(zipFile);
    // core.info('start unzip');
    // zip.extractAllTo('.', true);
    // core.info('finished unzip');
    let foundUnzipped = fs.readdirSync('./').filter(fn => fn.startsWith('CodeSignTool-v'))
    if (!foundUnzipped || foundUnzipped.length == 0) {
      core.warning("Could not find unzipped CodeSignTool, using LocalCodeSignTool");
      core.info(fs.readdirSync('./'));

      var zip2 = new admZip("./LocalCodeSignTool.zip");
      zip2.extractAllTo('.', true);
      foundUnzipped = fs.readdirSync('./').filter(fn => fn.startsWith('CodeSignTool-v'))
    }
    const folder = foundUnzipped[0];
    core.info(`Using folder: ${folder}`);

    if (!fs.existsSync(`./${folder}/ssl-output`)) {
      fs.mkdirSync(`./${folder}/ssl-output`);
    }

    core.info(process.env.CODE_SIGN_TOOL_PATH)
    process.env.CODE_SIGN_TOOL_PATH = path.join(__dirname + `/${folder}/`)
    core.info(process.env.CODE_SIGN_TOOL_PATH)

    if (isTest) {
      core.info("\tRUNNING TEST");
      const content = `CLIENT_ID=${sslclientid}\nOAUTH2_ENDPOINT=https://oauth-sandbox.ssl.com/oauth2/token\nCSC_API_ENDPOINT=https://cs-try.ssl.com\nTSA_URL=http://ts.ssl.com`;

      try {
        fs.writeFileSync('/Users/joe/test.txt', content);
        // file written successfully
      } catch (err) {
        console.error(err);
      }

    } else {
      core.info("\tRUNNING REAL USE CASE");
      ls = exec(path.join(__dirname + `/${folder}/test.bat`), function (err, stdout, stderr) {
        if (err) {
          console.log(stderr);
          return;
        }
        // Done.
        console.log(stdout);
      });

    }

    const files = fs.readdirSync(`./${folder}/ssl-output`);
    core.info(`SSL-OUTPUT: ${files}`)
    files.forEach(file => {
      core.info(__dirname + `/${folder}/ssl-output/` + file);
      core.info(path.join(__dirname + file));

      fs.copyFile(path.join(__dirname + `/${folder}/ssl-output/` + file), path.join(__dirname + "/" + file), err => {
        if (!err) {
          core.info(file + " has been copied!");
        } else {
          core.error(`COPY FAILED`)
          core.error(err)

          core.setFailed(error.message);
        }
      })
    });


    core.info((new Date()).toTimeString());


  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
