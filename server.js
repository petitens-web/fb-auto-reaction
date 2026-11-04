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
const MAX_BODY_BYTES = 10 * 1024;
let records = [];
let nextId = 1;
let writeQueue = Promise.resolve();
let requestQueue = Promise.resolve();

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

// Facebook Auto-Reaction Logic gamit ang fca-unofficial at appstate.json
function executeFacebookReaction(postUrl) {
    if (!fs.existsSync(APPSTATE_PATH)) {
        console.error("Error: appstate.json file not found! Hindi makapag-login sa Facebook.");
        return;
    }

    try {
        const appState = JSON.parse(fs.readFileSync(APPSTATE_PATH, "utf8"));

        login({ appState: appState }, (err, api) => {
            if (err) {
                console.error("Facebook Login Failed:", err);
                return;
            }

            console.log(`Logged in successfully! Nagpapadala ng reaksyon sa post: ${postUrl}`);
            
            // Note: Maaari mong i-parse ang post ID mula sa URL para magamit ang api.setPostReaction o iba pang methods
            // Halimbawa: api.setMessageReaction / setPostReaction depende sa version ng fca-unofficial mo.
        });
    } catch (error) {
        console.error("Error sa pagbasa ng appstate.json o pag-execute ng reaction:", error);
    }
}

function addRecord(platform, category, url) {
    const operation = requestQueue.then(async () => {
        const record = {
            id: nextId++,
            platform,
            category,
            url,
            status: "recorded",
            createdAt: new Date().toISOString()
        };
        records.unshift(record);

        try {
            await queueSave();
            
            // Kung Facebook ang platform at category ay Reactor request, i-trigger ang automation
            if (platform === "facebook" && category === "Reactor request") {
                executeFacebookReaction(url);
            }

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
                record = await addRecord(platform, category, urlValue);
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
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
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
