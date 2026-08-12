const fs = require('fs');

/** @author yuecheng */
function writeSummary(title, result, env = process.env) {
    const lines = [
        `## ${title}`,
        '',
        ...Object.entries(result).map(([key, value]) => {
            const rendered = Array.isArray(value)
                ? value.length > 0
                    ? value.join('; ')
                    : '无'
                : typeof value === 'object' && value !== null
                  ? JSON.stringify(value)
                  : String(value);
            return `- ${key}: \`${rendered}\``;
        }),
        '',
    ];
    const markdown = lines.join('\n');
    console.log(markdown);
    if (env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
    }
}

module.exports = { writeSummary };
