import { describe, expect, it } from "vitest";
import {
  companyChanged,
  matchConnections,
  normalizeName,
  parseCsv,
  parseLinkedInConnections,
  parseLinkedInDate,
  parseLinkedInNotification,
  personByName,
  samplePeople,
} from "./index";

// Shaped like LinkedIn's export: a notes preamble, then the header row.
const EXPORT = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed it."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Maya,Chen,https://www.linkedin.com/in/mayachen,maya@northwind.com,Northwind,"Director, Product Design",15 Sep 2024
Jordan,Blake,https://www.linkedin.com/in/jordanblake/,,Atlas,VP Product,02 Mar 2025
Élena,Ruiz,https://www.linkedin.com/in/elenaruiz,,"Harbor Health",Head of Product,09/15/24
,,,,,,
Someone,Else,not-a-linkedin-url,,,,
`;

describe("LinkedIn export", () => {
  it("parses quoted CSV with commas and newlines inside fields", () => {
    expect(parseCsv('a,"b, c","d\ne"\n1,"say ""hi""",3')).toEqual([["a", "b, c", "d\ne"], ["1", 'say "hi"', "3"]]);
  });

  it("finds the header past the notes and reads columns by name", () => {
    const { connections, skipped } = parseLinkedInConnections(EXPORT);
    expect(skipped).toBe(1);
    expect(connections).toHaveLength(3);
    expect(connections[0]).toEqual({
      profileUrl: "https://www.linkedin.com/in/mayachen",
      firstName: "Maya",
      lastName: "Chen",
      email: "maya@northwind.com",
      company: "Northwind",
      position: "Director, Product Design",
      connectedOn: "2024-09-15",
    });
    expect(connections[1]!.profileUrl).toBe("https://www.linkedin.com/in/jordanblake");
    expect(connections[2]!.connectedOn).toBe("2024-09-15");
  });

  it("works when LinkedIn reorders columns", () => {
    const { connections } = parseLinkedInConnections("Company,Last Name,First Name,URL\nAtlas,Blake,Jordan,https://www.linkedin.com/in/jb\n");
    expect(connections[0]).toMatchObject({ firstName: "Jordan", company: "Atlas", email: null });
  });

  it("rejects files that aren't the connections export", () => {
    expect(() => parseLinkedInConnections("Date,Amount\n2024-01-01,10")).toThrow(/Connections\.csv/);
  });

  it("reads LinkedIn's date formats", () => {
    expect(["15 Sep 2024", "Sep 15, 2024", "09/15/24", "2024-09-15"].map(parseLinkedInDate)).toEqual(Array(4).fill("2024-09-15"));
  });
});

describe("matching connections to people", () => {
  const { connections } = parseLinkedInConnections(EXPORT);

  it("matches by email automatically and by exact name only as a suggestion", () => {
    expect(matchConnections(connections, samplePeople)).toEqual([
      { profileUrl: "https://www.linkedin.com/in/mayachen", personId: "maya", how: "email" },
      { profileUrl: "https://www.linkedin.com/in/jordanblake", personId: "jordan", how: "name" },
      { profileUrl: "https://www.linkedin.com/in/elenaruiz", personId: "elena", how: "name" },
    ]);
  });

  it("won't guess when two people share a name", () => {
    const twins = [...samplePeople, { ...samplePeople[1]!, id: "jordan-2", emails: ["jordan@other.com"] }];
    expect(matchConnections(connections, twins).find((m) => m.profileUrl.endsWith("jordanblake"))).toBeUndefined();
  });

  it("normalizes names for matching", () => {
    expect(normalizeName("Élena  Ruiz, PhD")).toBe("elena ruiz");
    expect(normalizeName("Maya (she/her) Chen 🎨")).toBe("maya chen");
  });

  it("spots a company change, ignoring case and punctuation", () => {
    expect(companyChanged({ company: "Northwind" }, { company: "Atlas" })).toBe(true);
    expect(companyChanged({ company: "Harbor Health" }, { company: "harbor-health" })).toBe(false);
    expect(companyChanged({ company: null }, { company: "Atlas" })).toBe(false);
  });
});

describe("LinkedIn notification subjects", () => {
  const li = "LinkedIn <notifications-noreply@linkedin.com>";

  it("reads new positions in several phrasings", () => {
    expect(parseLinkedInNotification(li, "Congratulate Jordan Blake for starting a new position as VP Product at Atlas")).toEqual({
      kind: "new_position", name: "Jordan Blake", position: "VP Product", company: "Atlas",
    });
    expect(parseLinkedInNotification(li, "Maya Chen started a new position at Atlas")).toMatchObject({ name: "Maya Chen", company: "Atlas", position: null });
    expect(parseLinkedInNotification(li, "Maya Chen is now Head of Design at Atlas")).toMatchObject({ name: "Maya Chen", position: "Head of Design", company: "Atlas" });
  });

  it("reads posts by a named person", () => {
    expect(parseLinkedInNotification(li, "Maya Chen posted: What we learned redesigning checkout")).toEqual({
      kind: "post", name: "Maya Chen", text: "What we learned redesigning checkout",
    });
    expect(parseLinkedInNotification(li, "You appeared in 12 searches this week")).toBeNull();
  });

  it("ignores anything not sent by LinkedIn", () => {
    expect(parseLinkedInNotification("Spoof <notifications@linkedin.com.evil.io>", "Maya Chen started a new position at Atlas")).toBeNull();
  });

  it("finds the one person with a name", () => {
    expect(personByName(samplePeople, "maya chen")?.id).toBe("maya");
    expect(personByName(samplePeople, "Nobody Here")).toBeNull();
  });
});
