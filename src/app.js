const axios = require('axios');
const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');
const stripBom = require('strip-bom');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const outputDir = `${__dirname}/output`;
const outputDirJSON = `${outputDir}/json`;
const outputFileZip = 'output.zip'
const outputFileCSV = 'output.csv'

const APIToken = JSON.parse(stripBom(fs.readFileSync('./config.json', "utf8")));

let displayTranscriptIDsMessage = true;
fileNameTranscriptIDs = 'transcript_ids.json'

// End points
let transcriptsUrl = 'https://www.happyscribe.com/api/v1/transcriptions';
let exportsUrl = 'https://www.happyscribe.com/api/v1/exports';

let transcriptIds = [];

// Retrieves a single page metadata containing the IDs for individual transcripts
const getTranscriptMetadata = (url) => {
    return axios.get(url, {
        headers: {
            'Authorization': APIToken[0]['Authorization']
        }
    })
};

// Ensures all metadata pages are obtained and adds the IDs to an array
const getTranscriptIds = url => {
    return getTranscriptMetadata(url).then(value => {

        return new Promise((resolve, reject) => {

            if (displayTranscriptIDsMessage) {
                console.log("Retrieving transcript IDs...")
                displayTranscriptIDsMessage = false;
            }

            if (value.data.results.length > 0) {
                const ids = value.data.results.map(element => {
                    return element.id;
                });
                transcriptIds.push(ids);

                return new Promise((resolve, reject) => {
                    getTranscriptIds(value.data._links.next.url).then(res => {
                        resolve();
                    })
                })
            }
            let finalIds = [];

            // Flatten the array
            transcriptIds.map((arr) => {
                arr.forEach(e => {
                    finalIds.push(e);
                })
            });

            console.log("Completed.\n");

            let data = JSON.stringify(finalIds);
            try {
                fs.writeFileSync(fileNameTranscriptIDs, data);
                console.log("Re-run application to get export ID.")
            } catch (error) {
                console.log("Failed to write IDs to disk: " + error);
            }

            resolve(finalIds);
        })

    })
};

// Create the resource that will provide the download link to the transcript
const createExport = ids => {
    const body = {
        "export": {
            "format": "json",
            "transcription_ids": ids
        }
    }

    console.log("Creating export...");

    return axios.post(exportsUrl, body, {
        headers: {
            'Authorization': APIToken[0]['Authorization'],
            'Content-Type': 'application/json'
        }
    }).then(res => {
        console.log('Created export: ' + res.data.id + "\n");
        console.log('Re-run application and supply the export ID.');
        return res.data.id;
    }).catch(err => {
        reject('Failed to create export: ' + err);
    })
};

// Get the download link to the transcripts
const getExport = exportID => {
    console.log("Retrieving export...");

    return axios.get(exportsUrl + '/' + exportID, {
        headers: {
            'Authorization': APIToken[0]['Authorization']
        }
    }).then(res => {
        return new Promise((resolve, reject) => {
            if (res.data.download_link !== undefined) {
                console.log('Retrieved export: ' + res.data.download_link + '\n');
                resolve(res.data.download_link);
            } else {
                reject("Download link currently unavailable; wait a moment and try again.");
            }
        })
    }).catch(err => {
        console.log('Failed to retrieve export.');
        return Promise.reject(err);
    })
};

// Download the transcripts to disk as a .zip file
const getTranscripts = url => {
    console.log("Downloading transcripts...")

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    const outputPath = path.resolve(outputDir, outputFileZip)
    const writer = fs.createWriteStream(outputPath)

    return axios({
        url,
        method: 'GET',
        responseType: 'stream'
    }).then(response => {
        return new Promise((resolve, reject) => {
            response.data.pipe(writer);
            let error = null;
            writer.on('error', err => {
                error = err;
                writer.close();
                reject(err);
            });
            writer.on('close', () => {
                if (!error) {
                    console.log('Downloaded transcripts: ' + outputPath + '\n')
                    resolve(outputPath);
                }
            });
        })
    }).catch(err => {
        console.log("Unable to download file: " + err);
        return Promise.reject(err);
    });
};

// Unzip the transcripts
const extractTranscripts = filePath => {
    console.log('Extracting transcripts...')
    const target = outputDir
    return new Promise((resolve, reject) => {
        try {
            extract(filePath, { dir: outputDirJSON })
            console.log('Extraction complete: ' + target + "\n");
            console.log(`Re-run application with arguments 'csv' and the output location.`)
            resolve(true);
        } catch (err) {
            reject(err);
        }
    });
};

// Iterate through the JSON transcripts and piece together the separated words into full sentences.
// Add the data to an object that will be used to create the CSV.
const readTranscripts = () => {
    return new Promise((resolve, reject) => {
        fs.readdir(outputDirJSON, (err, files) => {

            if (err) {
                reject(err);
            }
            else {
                let cardData = [];

                files.forEach(file => {
                    // console.log('Reading ' + file + '...');

                    let data = JSON.parse(stripBom(fs.readFileSync(outputDirJSON + '/' + file, "utf8")));

                    // Access the individual words and construct the full sentence
                    data.forEach(d => {
                        let sentence = '';
                        d.words.forEach(w => {
                            sentence += w.text;
                        })

                        const audioFileName = file.toString().replace(/\.json/, '');
                        const item = { 'sentence': sentence, 'translation': '', 'notes': '', 'audio': `[sound:${audioFileName}]` };
                        cardData.push(item);
                    })
                })
                resolve(cardData);
            }
        });
    })
};

// Output the data to a CSV file
const writeToCsv = (cardData, destination) => {
    const csvWriter = createCsvWriter({
        path: destination + outputFileCSV,
        header: [
            { id: 'sentence', title: 'SENTENCE' },
            { id: 'translation', title: 'TRANSLATION' },
            { id: 'notes', title: 'NOTES' },
            { id: 'audio', title: 'AUDIO' },
        ],
        append: true,
        fieldDelimiter: ';',
    });

    return csvWriter.writeRecords(cardData).then(() => {
        console.log('Successfully wrote CSV file to ' + destination + outputFileCSV);
    }).catch(error => { console.log(error); });
};

// CMD
if (process.argv[2] === undefined) {
    if (!fs.existsSync(fileNameTranscriptIDs)) {
        getTranscriptIds(transcriptsUrl);
    } else {
        createExport(JSON.parse(stripBom(fs.readFileSync(fileNameTranscriptIDs, "utf8"))))
    }
} else if (process.argv[2] === 'csv' && process.argv[3] !== undefined) {
    readTranscripts()
        .then((cardData) => {
            writeToCsv(cardData, process.argv[3]);
        })
} else {
    getExport(process.argv[2])
        .then(url => {
            getTranscripts(url)
                .then(filePath => {
                    return extractTranscripts(filePath)
                })
        })
}
