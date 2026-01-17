// Node.js test script to check for basic JavaScript errors
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('barbie-racing-game.html', 'utf8');

try {
    const dom = new JSDOM(html, {
        runScripts: "dangerously",
        resources: "usable",
        beforeParse(window) {
            window.console.log = (...args) => console.log('[Page Log]', ...args);
            window.console.error = (...args) => console.error('[Page Error]', ...args);
        }
    });

    // Wait for scripts to execute
    setTimeout(() => {
        console.log('✓ Page loaded successfully');
        console.log('✓ Canvas element:', dom.window.document.getElementById('gameCanvas') ? 'Found' : 'Not found');
        console.log('✓ Start button:', dom.window.document.getElementById('startBtn') ? 'Found' : 'Not found');

        // Try to click start button
        try {
            dom.window.startRace();
            console.log('✓ startRace() function executed');
        } catch (err) {
            console.error('✗ Error calling startRace():', err.message);
        }

        process.exit(0);
    }, 1000);
} catch (error) {
    console.error('✗ Error loading page:', error.message);
    process.exit(1);
}
