const { createHash } = require('crypto');
const { gzipSync } = require('zlib');

const SNAPSHOT_FORMAT_VERSION = 1;
const GAME_FIELDS = [
    'name',
    'appid',
    'play_time',
    'achievement',
    'buy_time',
    'status',
    'favorite',
];
const HISTORY_FIELDS = ['name', 'appid', 'time', 'date'];
const GAME_FIELD_DEFINITIONS = {
    name: 'title',
    appid: 'number',
    play_time: 'number',
    achievement: 'number',
    buy_time: 'date',
    status: 'multi_select',
    favorite: 'checkbox',
};
const HISTORY_FIELD_DEFINITIONS = {
    name: 'title',
    appid: 'number',
    time: 'number',
    date: 'date',
};

const PROPERTY_VALUE_VALIDATORS = {
    title: (property) =>
        Array.isArray(property.title) &&
        property.title.every((item) => typeof item?.plain_text === 'string'),
    number: (property) =>
        property.number === null || Number.isFinite(property.number),
    date: (property) =>
        property.date === null ||
        (typeof property.date === 'object' &&
            typeof property.date.start === 'string' &&
            (property.date.end === null ||
                property.date.end === undefined ||
                typeof property.date.end === 'string') &&
            (property.date.time_zone === null ||
                property.date.time_zone === undefined ||
                typeof property.date.time_zone === 'string')),
    multi_select: (property) =>
        Array.isArray(property.multi_select) &&
        property.multi_select.every(
            (option) => typeof option?.name === 'string'
        ),
    checkbox: (property) => typeof property.checkbox === 'boolean',
};

/** @author yuecheng */
function compareValues(left, right) {
    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    return left < right ? -1 : 1;
}

/** @author yuecheng */
function richTextValue(items = []) {
    return items
        .map((item) => item.plain_text ?? item.text?.content ?? '')
        .join('');
}

/** @author yuecheng */
function normalizeDate(value) {
    if (!value) return null;
    return {
        start: value.start ?? null,
        end: value.end ?? null,
        time_zone: value.time_zone ?? null,
    };
}

/**
 * Rejects Notion schema drift instead of silently converting a renamed or
 * mistyped required property into an empty business value.
 *
 * @author yuecheng
 */
function assertPageSchema(page, definitions, entityName, index) {
    const pageLabel = page?.id ?? `at index ${index}`;
    if (!page?.properties || typeof page.properties !== 'object') {
        throw new Error(`${entityName} page ${pageLabel}: properties are missing`);
    }

    for (const [name, expectedType] of Object.entries(definitions)) {
        const property = page.properties[name];
        if (!property || typeof property !== 'object') {
            throw new Error(
                `${entityName} page ${pageLabel}: property ${name} is missing`
            );
        }
        if (property.type !== expectedType) {
            throw new Error(
                `${entityName} page ${pageLabel}: property ${name} expected ` +
                    `${expectedType} but received ${property.type ?? 'unknown'}`
            );
        }
        if (!PROPERTY_VALUE_VALIDATORS[expectedType]?.(property)) {
            throw new Error(
                `${entityName} page ${pageLabel}: property ${name} has an ` +
                    `invalid ${expectedType} value`
            );
        }
    }
}

/**
 * Keeps only restorable business fields. Notion page IDs and formula results are
 * intentionally excluded so they cannot trigger a backup.
 *
 * @author yuecheng
 */
function normalizeGames(pages) {
    return pages
        .map((page, index) => {
            assertPageSchema(
                page,
                GAME_FIELD_DEFINITIONS,
                'games',
                index
            );
            const { properties } = page;
            return {
                name: richTextValue(properties.name.title),
                appid: properties.appid.number,
                play_time: properties.play_time.number,
                achievement: properties.achievement.number,
                buy_time: normalizeDate(properties.buy_time.date),
                status: properties.status.multi_select
                    .map((option) => option.name)
                    .sort(compareValues),
                favorite: properties.favorite.checkbox,
            };
        })
        .sort(
            (left, right) =>
                compareValues(left.appid, right.appid) ||
                compareValues(left.name, right.name) ||
                compareValues(left.play_time, right.play_time) ||
                compareValues(left.achievement, right.achievement) ||
                compareValues(left.buy_time?.start, right.buy_time?.start) ||
                compareValues(left.buy_time?.end, right.buy_time?.end) ||
                compareValues(
                    left.buy_time?.time_zone,
                    right.buy_time?.time_zone
                ) ||
                compareValues(
                    JSON.stringify(left.status),
                    JSON.stringify(right.status)
                ) ||
                compareValues(left.favorite, right.favorite)
        );
}

/** @author yuecheng */
function normalizeHistory(pages) {
    return pages
        .map((page, index) => {
            assertPageSchema(
                page,
                HISTORY_FIELD_DEFINITIONS,
                'history',
                index
            );
            const { properties } = page;
            return {
                name: richTextValue(properties.name.title),
                appid: properties.appid.number,
                time: properties.time.number,
                date: normalizeDate(properties.date.date),
            };
        })
        .sort(
            (left, right) =>
                compareValues(left.date?.start, right.date?.start) ||
                compareValues(left.appid, right.appid) ||
                compareValues(left.time, right.time) ||
                compareValues(left.name, right.name) ||
                compareValues(left.date?.end, right.date?.end) ||
                compareValues(left.date?.time_zone, right.date?.time_zone)
        );
}

/** @author yuecheng */
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

/** @author yuecheng */
function contentHash(games, history) {
    return sha256(JSON.stringify({ games, history }));
}

/** @author yuecheng */
function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** @author yuecheng */
function toCsv(headers, rows) {
    return `${[headers, ...rows]
        .map((row) => row.map(csvCell).join(','))
        .join('\r\n')}\r\n`;
}

/** @author yuecheng */
function gamesCsv(games) {
    const headers = [
        'name',
        'appid',
        'play_time',
        'achievement',
        'buy_time',
        'buy_time_end',
        'buy_time_time_zone',
        'status',
        'favorite',
    ];
    return toCsv(
        headers,
        games.map((game) => [
            game.name,
            game.appid,
            game.play_time,
            game.achievement,
            game.buy_time?.start,
            game.buy_time?.end,
            game.buy_time?.time_zone,
            game.status.join(','),
            game.favorite,
        ])
    );
}

/** @author yuecheng */
function historyCsv(history) {
    const headers = [
        'name',
        'appid',
        'time',
        'date',
        'date_end',
        'date_time_zone',
    ];
    return toCsv(
        headers,
        history.map((record) => [
            record.name,
            record.appid,
            record.time,
            record.date?.start,
            record.date?.end,
            record.date?.time_zone,
        ])
    );
}

/** @author yuecheng */
function makeArtifact(content, contentType, contentEncoding) {
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    return {
        body,
        contentType,
        contentEncoding,
        size: body.length,
        sha256: sha256(body),
    };
}

/** @author yuecheng */
function buildSnapshot({ games, history, startedAt, completedAt, hash }) {
    const gamesJson = `${JSON.stringify(games, null, 2)}\n`;
    const historyJson = `${JSON.stringify(history, null, 2)}\n`;
    const artifacts = {
        'games.json.gz': makeArtifact(
            gzipSync(gamesJson, { mtime: 0 }),
            'application/json',
            'gzip'
        ),
        'history.json.gz': makeArtifact(
            gzipSync(historyJson, { mtime: 0 }),
            'application/json',
            'gzip'
        ),
        'games.csv': makeArtifact(gamesCsv(games), 'text/csv; charset=utf-8'),
        'history.csv': makeArtifact(
            historyCsv(history),
            'text/csv; charset=utf-8'
        ),
    };

    const manifest = {
        formatVersion: SNAPSHOT_FORMAT_VERSION,
        contentHash: hash,
        snapshotStartedAt: startedAt.toISOString(),
        snapshotCompletedAt: completedAt.toISOString(),
        fields: {
            games: GAME_FIELD_DEFINITIONS,
            history: HISTORY_FIELD_DEFINITIONS,
        },
        recordCounts: {
            games: games.length,
            history: history.length,
        },
        files: Object.fromEntries(
            Object.entries(artifacts).map(([name, artifact]) => [
                name,
                { size: artifact.size, sha256: artifact.sha256 },
            ])
        ),
    };
    artifacts['manifest.json'] = makeArtifact(
        `${JSON.stringify(manifest, null, 2)}\n`,
        'application/json; charset=utf-8'
    );

    return { artifacts, manifest };
}

/** @author yuecheng */
function formatDateParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** @author yuecheng */
function snapshotPrefix(date, hash, timeZone = 'Asia/Singapore') {
    const { year, month, day } = formatDateParts(date, timeZone);
    const timestamp = date.toISOString().replaceAll(/[-:.]/g, '');
    return `snapshots/${year}/${month}/${day}/${timestamp}-${hash.slice(0, 12)}`;
}

/**
 * Selects expired snapshot prefixes while always preserving the latest pointer,
 * all snapshots from the latest 90 days and the last snapshot of each older month.
 *
 * @author yuecheng
 */
function selectSnapshotsToDelete(
    snapshots,
    latestPrefix,
    now = new Date(),
    {
        recentDays = 90,
        monthlyMonths = 12,
        timeZone = 'Asia/Singapore',
    } = {}
) {
    const recentCutoff = now.getTime() - recentDays * 24 * 60 * 60 * 1000;
    const monthlyCutoffDate = new Date(now);
    monthlyCutoffDate.setUTCMonth(
        monthlyCutoffDate.getUTCMonth() - monthlyMonths
    );
    const monthlyCutoff = monthlyCutoffDate.getTime();
    const keep = new Set([latestPrefix]);
    const monthlyCandidates = new Map();

    for (const snapshot of snapshots) {
        const timestamp = new Date(snapshot.completedAt).getTime();
        if (!Number.isFinite(timestamp)) continue;
        if (timestamp >= recentCutoff) {
            keep.add(snapshot.prefix);
        } else if (timestamp >= monthlyCutoff) {
            const { year, month } = formatDateParts(
                new Date(timestamp),
                timeZone
            );
            const monthKey = `${year}-${month}`;
            const current = monthlyCandidates.get(monthKey);
            if (!current || timestamp > new Date(current.completedAt).getTime()) {
                monthlyCandidates.set(monthKey, snapshot);
            }
        }
    }

    for (const snapshot of monthlyCandidates.values()) {
        keep.add(snapshot.prefix);
    }

    return snapshots
        .filter((snapshot) => !keep.has(snapshot.prefix))
        .map((snapshot) => snapshot.prefix);
}

module.exports = {
    GAME_FIELD_DEFINITIONS,
    GAME_FIELDS,
    HISTORY_FIELD_DEFINITIONS,
    HISTORY_FIELDS,
    SNAPSHOT_FORMAT_VERSION,
    assertPageSchema,
    buildSnapshot,
    contentHash,
    gamesCsv,
    historyCsv,
    normalizeGames,
    normalizeHistory,
    selectSnapshotsToDelete,
    sha256,
    snapshotPrefix,
    toCsv,
};
