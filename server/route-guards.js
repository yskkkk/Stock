import { isAccessAdminRequest } from "./access-control.js";

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export function requireAccessAdmin(req, res, next) {
  if (!isAccessAdminRequest(req)) {
    res.status(403).json({
      error: "관리자 권한이 필요합니다.",
      code: "FORBIDDEN",
    });
    return;
  }
  next();
}
