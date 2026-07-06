import {
    Request,
    Response,
    NextFunction
} from "express";
import { ImportService } from "./multer.import";


export const importWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor = (req as any).user;

        const file = req.file;

        if (!file) {

            return res.status(400).json({

                success: false,

                message: "Excel file is required."

            });

        }

        const type =
            String(req.body.type).toUpperCase()

        if (
            type !== "PURCHASE" &&
            type !== "SALE"
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Type must be PURCHASE or SALE."

            });

        }

        const result =
            await ImportService.importWorkbook(
                actor,
                file,
                type
            );

        return res.status(200).json({

            success: true,

            message:
                `${type} Register imported successfully.`,

            data: result

        });

    }

    catch (error) {

        next(error);

    }

};