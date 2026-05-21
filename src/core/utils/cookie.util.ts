import { Response } from 'express';

export const AUTH_COOKIE_NAME = 'erp_token';

const isProduction = process.env.NODE_ENV === "production";

export const setAuthCookie = (res: Response, token: string) => {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction ? true : false,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 4 * 60 * 60 * 1000, // 4 hours
    path: '/',
  });
}

export const clearAuthCookie = (res: Response) => {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction ? true : false,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  });
}