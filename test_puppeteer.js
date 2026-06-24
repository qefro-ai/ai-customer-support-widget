const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream'
        ]
    });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));

    await page.goto('http://localhost:8081/test.html');
    
    // Wait for widget to load
    await new Promise(r => setTimeout(r, 2000));
    
    // Click mic button
    console.log('Clicking mic button...');
    await page.evaluate(() => {
        const micBtn = document.querySelector('.ai-widget-mic');
        if (micBtn) {
            micBtn.click();
        } else {
            console.log('Mic button not found!');
        }
    });

    // Wait a bit
    await new Promise(r => setTimeout(r, 5000));
    
    // Click again to stop
    console.log('Clicking mic button again...');
    await page.evaluate(() => {
        const micBtn = document.querySelector('.ai-widget-mic');
        if (micBtn) micBtn.click();
    });

    await new Promise(r => setTimeout(r, 2000));
    await browser.close();
})();
