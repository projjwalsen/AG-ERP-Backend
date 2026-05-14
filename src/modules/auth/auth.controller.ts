import { NextFunction, Request, Response } from 'express';
import { AuthService, LoginPayload, SignupPayload } from './auth.service';
import { clearAuthCookie, setAuthCookie } from '../../core/utils/cookie.util';

export const signup = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = req.body as SignupPayload;
        const result = await AuthService.signup(payload);

        setAuthCookie(res, result.token);

        res.status(201).json({
            success: true,
            message: 'Signup successful',
            data: {
                user: result.user,
            }
        });
    } catch (error) {
        console.log("Error in signup controller:", error);
        next(error);
    }
}

export const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = req.body as LoginPayload;
        const result = await AuthService.login(payload);

        setAuthCookie(res, result.token);

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: result.user,
            }
        });
    } catch (error) {
        next(error);
    }
}

export const getProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = (req as any).user;

    const profile = await AuthService.getProfile(actor.id);

    return res.status(200).json({
      success: true,
      message: "Profile fetched successfully",
      data: {
        profile,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
       clearAuthCookie(res);

       res.status(200).json({
        success: true,
        message: 'Logout successful',
       }); 
    } catch (error) {
        next(error);
    }
}