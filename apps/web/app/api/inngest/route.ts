import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

// Backfill pages and extraction batches can take a while.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
