import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function copyFileSync(source, target) {

  var targetFile = target;

  // If target is a directory, a new file with the same name will be created
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isDirectory()) {
      targetFile = path.join(target, path.basename(source));
    }
  }

  fs.writeFileSync(targetFile, fs.readFileSync(source));
}

function copyFolderRecursiveSync(source, target) {
  var files = [];

  // Check if folder needs to be created or integrated
  var targetFolder = path.join(target, path.basename(source));
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder);
  }

  // Copy
  if (fs.lstatSync(source).isDirectory()) {
    files = fs.readdirSync(source);
    files.forEach(function (file) {
      var curSource = path.join(source, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, targetFolder);
      } else {
        copyFileSync(curSource, targetFolder);
      }
    });
  }
}

console.log("Copying folder...");
copyFolderRecursiveSync(__dirname + '/../src/shared/constants', __dirname + '/../scripts/');
console.log("Folder copied");

const directoryPath = __dirname + '/../scripts/constants';

fs.readdir(directoryPath, (err, files) => {
  if (err) {
    return console.log('Unable to scan directory: ' + err);
  }

  files.forEach((file) => {
    // Check if the file has a .ts extension
    if (path.extname(file) === '.ts') {
      const oldPath = path.join(directoryPath, file);

      // Create the new filename by replacing .ts with .js
      const newPath = path.join(directoryPath, file.replace(/\.ts$/, '.js'));

      // Perform the rename
      fs.rename(oldPath, newPath, (err) => {
        if (err) {
          console.error(`Error renaming ${file}:`, err);
        } else {
          console.log(`Renamed: ${file} -> ${path.basename(newPath)}`);
          fnImportConst().then(() => {
            console.log("Done");
          });
        }
      });
    }
  });

});

async function fnImportConst() {
  const modulePath = new URL("../scripts/constants/app.constant.js", import.meta.url).href;
  const constants = await import(modulePath);
  const constantValue = constants.APP_DEV_BASEURL;
  console.log("Constant is...", constantValue);
  if (!constantValue || constantValue == "/") {
    console.log("Skip copy");
  }
  else {
    console.log("Copying artifact...");
    fs.mkdirSync(__dirname + '/../.output' + constantValue, { recursive: false });
    copyFolderRecursiveSync(__dirname + '/../.output/public', __dirname + '/../.output' + constantValue);
    fs.renameSync(__dirname + '/../.output' + constantValue + '/public', __dirname + '/../.output/public' + constantValue);
    fs.rmSync(__dirname + '/../.output' + constantValue);
    console.log("Folder copied");
  }
}