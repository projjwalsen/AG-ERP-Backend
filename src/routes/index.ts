import { Router } from "express";
import authRoute from "../modules/auth/auth.routes";
import userRoute from "../modules/user/user.routes";
import rbacRoute from "../modules/rbac/rbac.routes";

const router = Router();

router.use("/auth", authRoute);
router.use("/users", userRoute);
router.use("/rbac", rbacRoute);



export default router;