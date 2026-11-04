const http = require("http");
const fs = require("fs");
const path = require("path");
const login = require("fca-unofficial");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_PATH = path.join(DATA_DIR, "activity.json");
const APPSTATE_PATH = path.join(__dirname, "appstate.json");
const DASHBOARD_PATH = path.join(__dirname, "public", "index.html");

const PLATFORMS = new Set(["facebook", "tiktok", "instagram"]);
const CATEGORIES = new Set(["Reactor request", "Reaction tracking", "Activity record"]);

// Map reaction words to exact emoji characters expected by fca-unofficial
const REACTION_MAP = {
    "LIKE": "👍",
    "LOVE": "❤️",
    "CARE": "🤗",
    "HAHA": "😆",
    "WOW": "😮",
    "SAD": "😢",
    "ANGRY": "😡"
};

const MAX_BODY_BYTES = 10 * 1024;
let records = [];
let nextId = 1;
let writeQueue = Promise.resolve();
let requestQueue = Promise.resolve();

// Utility for extracting Facebook Post ID from URL
function extractFacebookPostId(url) {
    try {
        const parsed = new URL(url);
        if (parsed.searchParams.has("fbid")) {
            return parsed.searchParams.get("fbid");
        }
        if (parsed.searchParams.has("story_fbid")) {
            return parsed.searchParams.get("story_fbid");
        }
        const parts = parsed.pathname.split("/").filter(Boolean);
        const postIdx = parts.findIndex(p => ["posts", "permalink", "videos", "photos"].includes(p.toLowerCase()));
        if (postIdx !== -1 && parts[postIdx + 1]) {
            return parts[postIdx + 1];
        }
        const lastPart = parts[parts.length - 1];
        if (lastPart) return lastPart;
    } catch {
        // Fallback return original URL if parsing fails
    }
    return url;
}

// Function to trigger real reactions via fca-unofficial
function executeFacebookBot(postUrl, type, count = 1) {
    if (!fs.existsSync(APPSTATE_PATH)) {
        console.error("❌ Bot Error: appstate.json file not found!");
        return;
    }

    try {
        const appState = JSON.parse(fs.readFileSync(APPSTATE_PATH, "utf8"));
        const reactionEmoji = REACTION_MAP[(type || "").toUpperCase()] || "👍";
        const targetTarget = extractFacebookPostId(postUrl);

        console.log(`🤖 Starting bot execution for ${count} '${reactionEmoji}' reactions on target: ${targetTarget}`);

        login({ appState }, (err, api) => {
            if (err) {
                console.error("❌ Bot Login Failed:", err);
                return;
            }

            console.log("✅ Facebook Bot Session Logged In Successfully!");

            let dispatched = 0;
            const interval = setInterval(() => {
                if (dispatched >= count) {
                    clearInterval(interval);
                    console.log(`🎉 Completed sending ${count} reactions.`);
                    return;
                }

                const reactMethod = api.setPostReaction || api.setMessageReaction;
                if (typeof reactMethod === "function") {
                    reactMethod(targetTarget, reactionEmoji, (reactErr) => {
                        if (reactErr) {
                            console.error(`⚠️ Failed to send reaction #${dispatched + 1}:`, reactErr);
                        } else {
                            console.log(`👍 Reaction #${dispatched + 1} (${reactionEmoji}) dispatched!`);
                        }
                    });
                } else {
                    console.error("❌ Reaction method not supported by this fca version.");
                    clearInterval(interval);
                }

                dispatched++;
            }, 1000);
        });
    } catch (error) {
        console.error("❌ Error executing Facebook reaction logic:", error);
    }
}

function sendJson(response, status, payload) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(JSON.stringify(payload));
}

function sendText(response, status, message) {
    response.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(message);
}

function queueSave() {
    const snapshot = JSON.stringify(records, null, 2);
    writeQueue = writeQueue.catch(() => {}).then(async () => {
        const temporaryPath = `${DATA_PATH}.${process.pid}.tmp`;
        await fs.promises.writeFile(temporaryPath, snapshot, "utf8");
        await fs.promises.rename(temporaryPath, DATA_PATH);
    });
    return writeQueue;
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        let tooLarge = false;
        let bodyBytes = 0;

        request.setEncoding("utf8");
        request.on("data", (chunk) => {
            bodyBytes += Buffer.byteLength(chunk, "utf8");
            if (bodyBytes > MAX_BODY_BYTES) {
                tooLarge = true;
                body = "";
                return;
            }
            if (!tooLarge) body += chunk;
        });
        request.on("end", () => {
            if (tooLarge) {
                reject(Object.assign(new Error("Request body is too large"), { status: 413 }));
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(Object.assign(new Error("Request body must be valid JSON"), { status: 400 }));
            }
        });
        request.on("error", reject);
    });
}

function addRecord(platform, category, url, reactionType, botCount) {
    const operation = requestQueue.then(async () => {
        const record = {
            id: nextId++,
            platform,
            category,
            url,
            reactionType: reactionType || "LIKE",
            botCount: botCount || 1,
            status: "dispatched",
            createdAt: new Date().toISOString()
        };
        records.unshift(record);

        try {
            await queueSave();
            return record;
        } catch (error) {
            records.shift();
            nextId--;
            throw error;
        }
    });
    requestQueue = operation.catch(() => {});
    return operation;
}

function getStats() {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const activityByDay = Array.from({ length: 7 }, (_, index) => {
        const start = new Date(now - (6 - index) * day);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + day);
        return {
            label: start.toLocaleDateString("en", { weekday: "short" }),
            count: records.filter((record) => {
                const created = new Date(record.createdAt).getTime();
                return created >= start.getTime() && created < end.getTime();
            }).length
        };
    });

    return {
        total: records.length,
        recorded: records.length,
        recent: records.slice(0, 5).length,
        activityByDay
    };
}

const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, `http://${HOST}`).pathname;

    if (pathname === "/health" && request.method === "GET") {
        sendJson(response, 200, { status: "ok" });
        return;
    }

    if (pathname === "/api/activities" && request.method === "GET") {
        sendJson(response, 200, { records: records.slice(0, 100), stats: getStats() });
        return;
    }

    if (pathname === "/api/requests" && request.method === "POST") {
        if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
            sendJson(response, 415, { error: "Content-Type must be application/json" });
            return;
        }

        try {
            const body = await readJsonBody(request);
            const platform = typeof body.platform === "string" ? body.platform.toLowerCase() : "";
            const category = body.category;
            const urlValue = typeof body.url === "string" ? body.url.trim() : "";
            const reactionType = typeof body.reactionType === "string" ? body.reactionType : "LIKE";
            const botCount = Number(body.botCount) || 1;

            if (!PLATFORMS.has(platform)) {
                sendJson(response, 400, { error: "Choose a supported platform" });
                return;
            }
            if (!CATEGORIES.has(category)) {
                sendJson(response, 400, { error: "Choose a supported request category" });
                return;
            }
            if (urlValue.length > 2048) {
                sendJson(response, 400, { error: "URL must be 2048 characters or fewer" });
                return;
            }

            let parsedUrl;
            try {
                parsedUrl = new URL(urlValue);
            } catch {
                sendJson(response, 400, { error: "Enter a valid http or https URL" });
                return;
            }
            if (!["http:", "https:"].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
                sendJson(response, 400, { error: "Enter a valid http or https URL" });
                return;
            }

            let record;
            try {
                record = await addRecord(platform, category, urlValue, reactionType, botCount);
                
                if (platform === "facebook") {
                    executeFacebookBot(urlValue, reactionType, botCount);
                }
            } catch (error) {
                console.error("Could not save request:", error);
                sendJson(response, 500, { error: "Could not save the request. Check server permissions and try again." });
                return;
            }

            sendJson(response, 201, { record, stats: getStats() });
        } catch (error) {
            if (error.status) {
                sendJson(response, error.status, { error: error.message });
                return;
            }
            console.error("Could not process request:", error);
            sendJson(response, 500, { error: "Could not process the request" });
        }
        return;
    }

    if (pathname === "/" && request.method === "GET") {
        fs.readFile(DASHBOARD_PATH, (error, content) => {
            if (error) {
                console.error("Could not load the dashboard:", error);
                sendText(response, 500, "Could not load the dashboard");
                return;
            }
            response.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff"
            });
            response.end(content);
        });
        return;
    }

    if (pathname.startsWith("/api/")) {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
    }
    if (request.method !== "GET") {
        sendText(response, 405, "Method not allowed");
        return;
    }
    sendText(response, 404, "Not found");
});

async function start() {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    try {
        const savedRecords = JSON.parse(await fs.promises.readFile(DATA_PATH, "utf8"));
        if (!Array.isArray(savedRecords) || savedRecords.some((record) =>
            !record || !Number.isInteger(record.id) || typeof record.createdAt !== "string"
        )) {
            throw new Error("Activity database has an invalid format");
        }
        records = savedRecords.sort((a, b) => b.id - a.id);
        nextId = records.reduce((maxId, record) => Math.max(maxId, record.id), 0) + 1;
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    server.listen(PORT, HOST, () => {
        console.log(`Dashboard running at http://${HOST}:${PORT}`);
        console.log(`Saved request records: ${records.length}`);
    });
}

start().catch((error) => {
    console.error("Could not start the dashboard:", error);
    process.exitCode = 1;
});
