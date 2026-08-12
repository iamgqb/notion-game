const fs = require('fs');
const path = require('path');

/**
 * Loads local development variables without overriding values supplied by CI.
 *
 * @author yuecheng
 * @param {string} [envPath]
 */
function loadEnv(envPath = path.resolve(__dirname, '../.env')) {
    if (!fs.existsSync(envPath)) {
        return;
    }

    const envFileContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envFileContent.split(/\r?\n/)) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmedLine.indexOf('=');
        if (separatorIndex < 1) {
            continue;
        }

        const key = trimmedLine.slice(0, separatorIndex).trim();
        let value = trimmedLine.slice(separatorIndex + 1).trim();
        const quote = value[0];
        if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
            value = value.slice(1, -1);
        }

        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

module.exports = { loadEnv };
