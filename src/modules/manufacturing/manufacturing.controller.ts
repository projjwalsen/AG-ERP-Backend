import { Request, Response, NextFunction } from "express";
import { ManufacturingService } from "./manufacturing.service";

const actor = (req: Request) => (req as any).user;

export const createRecipe = async (req: Request, res: Response, next: NextFunction) => {
    try { return res.status(201).json({ success: true, message: "Recipe created successfully", data: { recipe: await ManufacturingService.createRecipe(actor(req), req.body) } }); } catch (e) { next(e); }
};
export const listRecipes = async (req: Request, res: Response, next: NextFunction) => {
    try { return res.json({ success: true, message: "Recipes retrieved successfully", data: { recipes: await ManufacturingService.listRecipes(actor(req), req.query.status as any) } }); } catch (e) { next(e); }
};
export const approveRecipe = async (req: Request, res: Response, next: NextFunction) => {
    try { return res.json({ success: true, message: "Recipe approved successfully", data: { recipe: await ManufacturingService.approveRecipe(actor(req), (req as any).params.recipeId) } }); } catch (e) { next(e); }
};
export const rejectRecipe = async (req: Request, res: Response, next: NextFunction) => {
    try { return res.json({ success: true, message: "Recipe rejected successfully", data: { recipe: await ManufacturingService.rejectRecipe(actor(req), (req as any).params.recipeId, req.body?.remarks) } }); } catch (e) { next(e); }
};
export const previewManufacture = async (req: Request, res: Response, next: NextFunction) => {
    try { return res.json({ success: true, message: "Manufacturing preview generated successfully", data: await ManufacturingService.previewManufacture(actor(req), req.body) }); } catch (e) { next(e); }
};
export const createManufacture = async (req: Request, res: Response, next: NextFunction) => {
    try { return res.status(201).json({ success: true, message: "Manufacturing document created successfully", data: { manufacture: await ManufacturingService.createManufacture(actor(req), req.body) } }); } catch (e) { next(e); }
};
export const listManufactures = async (req: Request, res: Response, next: NextFunction) => {
    try { return res.json({ success: true, message: "Manufacturing documents retrieved successfully", data: { manufactures: await ManufacturingService.listManufactures(actor(req), req.query.status as any, req.query.branchId as string) } }); } catch (e) { next(e); }
};
export const approveManufacture = async (req: Request, res: Response, next: NextFunction) => {
    try { return res.json({ success: true, message: "Manufacturing approved successfully", data: { manufacture: await ManufacturingService.approveManufacture(actor(req), (req as any).params.manufactureId) } }); } catch (e) { next(e); }
};
export const rejectManufacture = async (req: Request, res: Response, next: NextFunction) => {
    try { return res.json({ success: true, message: "Manufacturing rejected successfully", data: { manufacture: await ManufacturingService.rejectManufacture(actor(req), (req as any).params.manufactureId, req.body?.remarks) } }); } catch (e) { next(e); }
};
