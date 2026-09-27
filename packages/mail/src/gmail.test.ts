import { describe, expect, it } from "vitest";
import { decodeBase64Url, encodeBase64Url, messageText, stripQuoted } from "./gmail";

describe("gmail parsing", () => {
  it("round-trips base64url, including non-ASCII", () => {
    const text = "Café — let's talk in Q1?";
    expect(decodeBase64Url(encodeBase64Url(text))).toBe(text);
  });

  it("prefers text/plain inside multipart messages", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { size: 1, data: encodeBase64Url("<p>HTML version</p>") } },
        { mimeType: "text/plain", body: { size: 1, data: encodeBase64Url("Plain version") } },
      ],
    };
    expect(messageText(payload)).toBe("Plain version");
  });

  it("falls back to HTML converted to text", () => {
    const payload = { mimeType: "text/html", body: { size: 1, data: encodeBase64Url("<div>Hi Dana,</div><div>Budget is $15k&nbsp;total.</div>") } };
    expect(messageText(payload)).toBe("Hi Dana,\nBudget is $15k total.");
  });

  it("drops quoted history so each message is read once", () => {
    const body = "Sounds good, Friday works.\n\nOn Tue, Sep 8, 2026 at 9:14 AM Priya <priya@fieldnote.app> wrote:\n> Can you send a proposal?\n> Thanks";
    expect(stripQuoted(body)).toBe("Sounds good, Friday works.");
  });
});
