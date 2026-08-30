const fs = require('fs');

/** @author yuecheng */
function appendGithubOutputs(values, env = process.env) {
    if (!env.GITHUB_OUTPUT) return;
    const lines = Object.entries(values).map(([name, value]) => {
        const text = String(value ?? '');
        if (/[\r\n]/.test(text)) {
            throw new Error(`GitHub output ${name} must be a single line`);
        }
        return `${name}=${text}`;
    });
    fs.appendFileSync(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, 'utf8');
}

module.exports = { appendGithubOutputs };
