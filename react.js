const fs = require('fs');
const login = require('fca-unofficial');

login({appState: JSON.parse(fs.readFileSync('appstate.json', 'utf8'))}, (err, api) => {
    if (err) return console.error("Login Error:", err);

    console.log("Successfully logged in via AppState!");

    const readline = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout
    });

    readline.question("Ilagay ang Link ng Facebook Post: ", (input) => {
        let rawInput = input.trim();
        let postId = null;

        // Clean parameters (alisin ang ?__cft__ at &__tn__)
        let cleanUrl = rawInput.split('?')[0].split('&')[0];

        // Match pfbid o numeric ID
        let pfbidMatch = cleanUrl.match(/(pfbid[a-zA-Z0-9]+)/);
        let numericMatch = cleanUrl.match(/([0-9]{10,})/);

        if (pfbidMatch) {
            postId = pfbidMatch[1];
        } else if (numericMatch) {
            postId = numericMatch[1];
        } else if (/^[0-9]+$/.test(rawInput) || /^pfbid/.test(rawInput)) {
            postId = rawInput;
        }

        if (!postId) {
            console.log("❌ Hindi makuha ang Post ID. Subukan ang ibang link.");
            readline.close();
            return;
        }

        console.log(`⏳ Target Post ID: ${postId}`);

        // Mag-react ng 'LOVE' (❤️)
        api.setMessageReaction("❤️", postId, (err) => {
            if (err) {
                console.log("❌ Error sa pag-react:", err);
            } else {
                console.log("✅ Tagumpay na nakapag-react ng ❤️ sa post!");
            }
            readline.close();
        });
    });
});