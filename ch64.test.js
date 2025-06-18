import ch64 from "./ch64.js";
import { test, describe } from "node:test";
import assert from "node:assert";
import { execSync } from "node:child_process";

const query = async (sql) => {
  try {
    const result = execSync("clickhouse local --output-format JSONEachRow", {
      input: sql,
      encoding: "utf8",
      timeout: 30000,
    });

    const lines = result
      .trim()
      .split("\n")
      .filter((line) => line.trim());
    return lines.map((line) => JSON.parse(line));
  } catch (error) {
    throw new Error(`ClickHouse query failed: ${error.message}`);
  }
};

describe("ch64", () => {
  const getClickHouseHashes = async (keys) => {
    const columns = keys
      .map((key, i) => `cityHash64('${key}') as key_${i}`)
      .join(", ");
    const queryStr = `SELECT ${columns}`;

    const result = await query(queryStr);
    return result[0];
  };

  const expectEqualHashes = (clickhouseHashLookup, testValues) => {
    for (const [i, key] of testValues.entries()) {
      const chHash = clickhouseHashLookup[`key_${i}`];
      const jsHash = ch64(key).toString();

      assert.deepStrictEqual(
        {
          key,
          hash: chHash,
        },
        {
          key,
          hash: jsHash,
        },
      );
    }
  };

  const generateRandomStringOfLength = (length) => {
    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const charactersLength = characters.length;

    let result = "";

    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }

    return result;
  };

  test("produces correct hash values for randomize test strings", async () => {
    for (let i = 0; i < 10; i++) {
      const randomTestStrings = Array.from({ length: 1000 }, () =>
        generateRandomStringOfLength(i + 1),
      );
      const res = await getClickHouseHashes(randomTestStrings);

      expectEqualHashes(res, randomTestStrings);
    }
  });
});
