import { Router } from "express";
import authRoute from "../modules/auth/auth.routes";
import userRoute from "../modules/user/user.routes";
import rbacRoute from "../modules/rbac/rbac.routes";
import branchRoute from "../modules/branch/branch.routes";
import agencyRoute from "../modules/agency/agency.routes";

const router = Router();

router.use("/auth", authRoute);
router.use("/users", userRoute);
router.use("/rbac", rbacRoute);
router.use("/branches", branchRoute);
router.use("/agencies", agencyRoute);



export default router;