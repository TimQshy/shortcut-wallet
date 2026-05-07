import ratelimit from '../config/upStash.js';

const rateLimiter = async (req, res, next) => {
    try {
  const { success } = await ratelimit.limit("my-rate-limit");
        if (!success) {
            return res.status(429).json({ message: "Too many requests" });
        }
        next();
    } catch (error) {
        console.log("Error in rate limiter", error);
        next(error);
    }
}
export default rateLimiter;