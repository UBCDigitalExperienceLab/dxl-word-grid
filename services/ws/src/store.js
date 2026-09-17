/**
 * DynamoDB access layer for word-grid rooms.
 *
 * Single table (default: dxl-word-grid-dev-rooms), on-demand billing.
 *
 * Keys
 * | pk                 | sk                  | item                                  |
 * |--------------------|---------------------|---------------------------------------|
 * | ROOM#<code>        | META                | room settings, phase, host, grid, endAt |
 * | ROOM#<code>        | PLAYER#<playerId>   | player name, color, connectionId, finds |
 * | CONN#<connId>      | META                | reverse lookup { code, playerId }       |
 *
 * GSI1 (fan-out): gsi1pk = ROOM#<code>, gsi1sk = CONN#<connId>
 *   Lets a handler list every live connection in a room to broadcast.
 *
 * Rooms carry a TTL attribute (`expiresAt`, epoch seconds) so abandoned rooms
 * are reaped automatically by DynamoDB and never accrue cost.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE_NAME ?? "dxl-word-grid-dev-rooms";
const ROOM_TTL_SECONDS = 60 * 60 * 3; // rooms self-destruct after 3h of inactivity

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function ttl() {
  return Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS;
}

// ── Rooms ──────────────────────────────────────────────────────────

export async function putRoom(room) {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `ROOM#${room.code}`,
        sk: "META",
        expiresAt: ttl(),
        room,
      },
    }),
  );
}

export async function getRoom(code) {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${code}`, sk: "META" } }),
  );
  return res.Item?.room ?? null;
}

export async function roomExists(code) {
  const res = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: `ROOM#${code}`, sk: "META" },
      ProjectionExpression: "pk",
    }),
  );
  return Boolean(res.Item);
}

/** Patch top-level fields on the stored room object. */
export async function patchRoom(code, fields) {
  const names = {};
  const values = {};
  const sets = [];
  let i = 0;
  for (const [key, value] of Object.entries(fields)) {
    names[`#f${i}`] = "room";
    names[`#k${i}`] = key;
    values[`:v${i}`] = value;
    sets.push(`#f${i}.#k${i} = :v${i}`);
    i += 1;
  }
  values[":ttl"] = ttl();
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `ROOM#${code}`, sk: "META" },
      UpdateExpression: `SET ${sets.join(", ")}, expiresAt = :ttl`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function deleteRoom(code) {
  await doc.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: `ROOM#${code}`, sk: "META" } }),
  );
}

// ── Players ────────────────────────────────────────────────────────

export async function putPlayer(code, player) {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `ROOM#${code}`,
        sk: `PLAYER#${player.id}`,
        gsi1pk: `ROOM#${code}`,
        gsi1sk: `CONN#${player.connectionId}`,
        expiresAt: ttl(),
        player,
      },
    }),
  );
}

export async function getPlayer(code, playerId) {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `ROOM#${code}`, sk: `PLAYER#${playerId}` } }),
  );
  return res.Item?.player ?? null;
}

export async function listPlayers(code) {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": `ROOM#${code}`, ":sk": "PLAYER#" },
    }),
  );
  return (res.Items ?? []).map((item) => item.player).filter(Boolean);
}

export async function deletePlayer(code, playerId) {
  await doc.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: `ROOM#${code}`, sk: `PLAYER#${playerId}` } }),
  );
}

/** Append a found word to a player's finds atomically. */
export async function addFind(code, playerId, word) {
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `ROOM#${code}`, sk: `PLAYER#${playerId}` },
      UpdateExpression:
        "SET #p.#finds = list_append(if_not_exists(#p.#finds, :empty), :word), expiresAt = :ttl",
      ExpressionAttributeNames: { "#p": "player", "#finds": "finds" },
      ExpressionAttributeValues: { ":word": [word], ":empty": [], ":ttl": ttl() },
    }),
  );
}

// ── Connections ────────────────────────────────────────────────────

export async function putConnection(connectionId, code, playerId) {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `CONN#${connectionId}`,
        sk: "META",
        expiresAt: ttl(),
        code,
        playerId,
      },
    }),
  );
}

export async function getConnection(connectionId) {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `CONN#${connectionId}`, sk: "META" } }),
  );
  return res.Item ? { code: res.Item.code, playerId: res.Item.playerId } : null;
}

export async function deleteConnection(connectionId) {
  await doc.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: `CONN#${connectionId}`, sk: "META" } }),
  );
}
