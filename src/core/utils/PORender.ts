import fs from "fs";
import path from "path";
import Handlebars from "handlebars";
import puppeteer from "puppeteer";

export class PurchaseOrderRenderer {

    static async compileTemplate(
        data: any
    ) {

        const filePath =
            path.join(
                process.cwd(),
                "src/core/template/PurchaseOrder.hbs"
            );

        const html =
            fs.readFileSync(
                filePath,
                "utf-8"
            );

        const template =
            Handlebars.compile(html);

        return template(data);
    }


    static async generatePdf(
        data: any
    ) {

        const compiledHtml =
            await this.compileTemplate(data);

        const browser =
            await puppeteer.launch({
                headless: true,

                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox"
                ]
            });

        try {

            const page =
                await browser.newPage();

            await page.setContent(
                compiledHtml,
                {
                    waitUntil:
                        "domcontentloaded"
                }
            );

            await page.evaluate(`
                (async () => {

                    await document.fonts.ready;

                    await Promise.all(
                        Array.from(
                            document.images
                        ).map(image => {

                            if (image.complete) {
                                return Promise.resolve();
                            }

                            return new Promise(resolve => {

                                image.addEventListener(
                                    "load",
                                    resolve,
                                    { once: true }
                                );

                                image.addEventListener(
                                    "error",
                                    resolve,
                                    { once: true }
                                );

                            });

                        })
                    );

                })()
            `);

            return await page.pdf({

                format: "A4",

                printBackground: true,

                preferCSSPageSize: true,

                margin: {
                    top: "0",
                    right: "0",
                    bottom: "0",
                    left: "0"
                }
            });

        } finally {

            await browser.close();

        }
    }
}