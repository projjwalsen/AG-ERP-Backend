import jwt, { SignOptions } from 'jsonwebtoken';

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT secret is not defined');
    }
  return secret;
};

export const generateToken = (payload: object) => {
    const options: SignOptions = {
        expiresIn: '4h', // Token expires in 4 hours
    };
    return jwt.sign(payload, getJwtSecret(), options);
}

export const verifyAuthToken = <T = any>(token: string): T => {
  return jwt.verify(token, getJwtSecret()) as T;
};