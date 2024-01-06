const { join } = require('path');
const { Low, JSONFilejoin } = require('lowdb');

const path = require('path');
const fs = require('fs');

const directoryPath = path.join("./database", 'Documents');

fs.readdir(directoryPath, function (err, files) {
    //handling error
    if (err) {
        return console.log('Unable to scan directory: ' + err);
    } 
    //listing all files using forEach
    files.forEach(function (file) {
        // Do whatever you want to do with the file
        console.log(file); 
    });
});

return directoryPath