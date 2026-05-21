import { Brevo, BrevoClient } from "@getbrevo/brevo";

export const brevoClient = new BrevoClient({
    apiKey: process.env.BREVO_KEY || "",
    timeoutInSeconds: 40,
    maxRetries: 0,
});

export class MailError extends Error {
    public code: string;
    public statusCode: number;
    public cause?: unknown;

    constructor(
        message: string,
        code: string,
        statusCode = 500,
        cause?: unknown
    ) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.cause = cause;

        Object.setPrototypeOf(this, MailError.prototype);
    }
}