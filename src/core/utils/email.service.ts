import { Brevo } from "@getbrevo/brevo";
import { brevoClient, MailError } from "../../config/mail";

type EmailRecipient = {
    email: string;
    name?: string;
};

type EmailAttachment = {
    name: string;
    content: Buffer | string;
};

type SendEmailPayload = {
    to: EmailRecipient[];
    subject: string;
    htmlContent: string;
    textContent?: string;
    replyTo?: EmailRecipient;
    attachments?: EmailAttachment[];
    tags?: string[];
};

export class EmailService {

    static isEnabled() {
        return String(
            process.env.EMAIL_ENABLED ?? "true"
        ).toLowerCase() !== "false";
    }

    static async sendTransactionalEmail(
        payload: SendEmailPayload
    ) {
        if (!this.isEnabled()) {
            return {
                skipped: true,
                reason: "EMAIL_DISABLED"
            };
        }

        const apiKey =
            process.env.BREVO_API_KEY ||
            process.env.BREVO_KEY;

        if (!apiKey) {
            throw new MailError(
                "Brevo API key is not configured",
                "BREVO_API_KEY_MISSING",
                500
            );
        }

        const senderEmail =
            process.env.BREVO_SENDER_EMAIL ||
            process.env.BREVO_FROM_EMAIL;

        if (!senderEmail) {
            throw new MailError(
                "Brevo sender email is not configured",
                "BREVO_SENDER_EMAIL_MISSING",
                500
            );
        }

        const request: Brevo.SendTransacEmailRequest = {
            sender: {
                email: senderEmail,
                name:
                    process.env.BREVO_SENDER_NAME ||
                    "A G Ashtavinayaka Petrochem Pvt Ltd"
            },
            to: payload.to,
            subject: payload.subject,
            htmlContent: payload.htmlContent,
            textContent: payload.textContent,
            replyTo: payload.replyTo,
            tags: payload.tags,
            attachment: payload.attachments?.map((attachment) => ({
                name: attachment.name,
                content:
                    Buffer.isBuffer(attachment.content)
                        ? attachment.content.toString("base64")
                        : attachment.content
            }))
        };

        try {
            return await brevoClient.transactionalEmails
                .sendTransacEmail(request);
        } catch (error) {
            throw new MailError(
                "Unable to send transactional email",
                "BREVO_SEND_FAILED",
                502,
                error
            );
        }
    }
}
