import express from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { db } from "../db.js";
import { verifyUser } from "../middleware/verifyUser.js";

const router = express.Router();

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// If Stripe rejects "bdt" for your account, change these two lines to:
// const PRICE_CURRENCY = "usd";  const PRICE_AMOUNT = 13;
const PRICE_CURRENCY = "bdt";
const PRICE_AMOUNT = 1500;

const makePremium = async (userId, sessionId) => {
  await db
    .collection("user")
    .updateOne(
      { _id: new ObjectId(userId) },
      { $set: { isPremium: true, updatedAt: new Date() } }
    );

  await db.collection("payments").updateOne(
    { sessionId },
    {
      $setOnInsert: {
        sessionId,
        userId,
        amount: PRICE_AMOUNT,
        currency: PRICE_CURRENCY,
        paidAt: new Date(),
      },
    },
    { upsert: true }
  );
};

router.post("/create-checkout-session", verifyUser, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ message: "Payments are not set up yet" });
    }
    if (req.user.isPremium === true) {
      return res.status(400).json({ message: "You are already a Premium member" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: req.user.email,
      line_items: [
        {
          price_data: {
            currency: PRICE_CURRENCY,
            product_data: { name: "LifeLessons Premium (lifetime access)" },
            unit_amount: PRICE_AMOUNT * 100,
          },
          quantity: 1,
        },
      ],
      metadata: { userId: req.user.id },
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe error:", error.message);
    res.status(500).json({ message: "Could not start the payment" });
  }
});

router.get("/confirm-payment", verifyUser, async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!stripe || !sessionId) {
      return res.status(400).json({ message: "Payment not found" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (
      session.payment_status !== "paid" ||
      session.metadata?.userId !== req.user.id
    ) {
      return res.status(400).json({ message: "Payment not completed" });
    }

    await makePremium(req.user.id, session.id);
    res.json({ isPremium: true });
  } catch (error) {
    console.error("Confirm error:", error.message);
    res.status(500).json({ message: "Could not confirm the payment" });
  }
});

export const stripeWebhook = async (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    return res.status(400).send("Webhook signature check failed");
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid" && session.metadata?.userId) {
        await makePremium(session.metadata.userId, session.id);
      }
    }
    res.json({ received: true });
  } catch (error) {
    res.status(500).send("Webhook handler failed");
  }
};

export default router;