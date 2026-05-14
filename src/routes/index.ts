import { Router } from "express";
import authRoute from "../modules/auth/auth.routes";
import userRoute from "../modules/user/user.routes"

const router = Router();

router.use("/auth", authRoute);
router.use("/users", userRoute);




export default router;