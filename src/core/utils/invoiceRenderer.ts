import fs from "fs";
import path from "path";
import Handlebars from "handlebars";
import puppeteer from "puppeteer";

export class InvoiceRenderer {

    /** Compile invoice template */
    static async compileTemplate(data: any) {
        const filePath = path.join(
            process.cwd(),
            "src/core/template/invoice.hbs"
        );

        const html = fs.readFileSync(filePath, "utf-8");

        const template = Handlebars.compile(html);

        return template(data);
    }


    /** Generate pdf buffer */
    static async generatePdf(data: any) {
        const compiledHtml = await this.compileTemplate(data);
        const executablePath = puppeteer.executablePath() as any || '/opt/render/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome';
        console.log("Puppeteer executable path:", executablePath);
        const browser = await puppeteer.launch({
            executablePath,
            headless: true,
            timeout: 0,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ]
        });

        try {
            const page = await browser.newPage();
    
            await page.setContent(compiledHtml, {
                waitUntil: "domcontentloaded"
            });
    
            const pdf = await page.pdf({
                format: "A4",
                printBackground: true,
                margin: {
                    top: "0",
                    right: "0",
                    bottom: "0",
                    left: "0"
                }
            });
    
            
            return pdf;
            
        } finally {
            await browser.close();
        }
    }
}