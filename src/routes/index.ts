import { Router } from "express";
import authRoute from "../modules/auth/auth.routes";
import userRoute from "../modules/user/user.routes";
import rbacRoute from "../modules/rbac/rbac.routes";
import branchRoute from "../modules/branch/branch.routes";
import agencyRoute from "../modules/agency/agency.routes";
import metaRoute from "../modules/meta/meta.routes";
import productRoute from "../modules/product_master/product.routes";
import inventoryRoute from "../modules/inventory/inventory.routes";
import salesRoute from "../modules/sales/sales.routes";
import purchaseRoute from "../modules/purchase/purchase.routes";
import transactionRoute from "../modules/transaction/transac.routes";
import settingRoute from "../modules/settings/setting.routes";

const router = Router();

router.use("/auth", authRoute);
router.use("/users", userRoute);
router.use("/meta", metaRoute);
router.use("/rbac", rbacRoute);
router.use("/branches", branchRoute);
router.use("/agencies", agencyRoute);
router.use("/products", productRoute);
router.use("/inventory", inventoryRoute);
router.use("/sales", salesRoute);
router.use("/purchases", purchaseRoute);
router.use("/settings", settingRoute);
router.use("/transactions", transactionRoute);




export default router;