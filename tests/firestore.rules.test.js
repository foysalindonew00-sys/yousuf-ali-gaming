const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require("@firebase/rules-unit-testing");
const {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} = require("firebase/firestore");
const { before, after, beforeEach, test } = require("node:test");

const PROJECT_ID = "demo-yousuf-ali-gaming";
const ADMIN_UID = "gIsJxXOyGKhUhf6ontux2zJnF9N2";
const BUYER_UID = "buyer-uid-001";
const OTHER_UID = "buyer-uid-002";

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8")
    }
  });
});

after(async () => {
  if (env) await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

function order(overrides = {}) {
  return {
    uid: "1234567890",
    customerUid: BUYER_UID,
    server: "Indonesia",
    contact: "08123456789",
    paymentMethod: "bKash",
    transactionId: "TRX123456",
    package: "50 Diamonds",
    amount: "50 DM",
    total: 64,
    status: "Pending",
    createdAt: serverTimestamp(),
    ...overrides
  };
}

function buyerDb(uid = BUYER_UID, email = "buyer@example.com") {
  return env.authenticatedContext(uid, { email }).firestore();
}

function adminDb() {
  return env.authenticatedContext(ADMIN_UID, { email: "admin@example.com" }).firestore();
}

test("unauthenticated visitors cannot read or create private orders", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDocs(collection(db, "orders")));
  await assertFails(setDoc(doc(db, "orders", "guest-order"), order()));
});

test("a signed-in buyer can create a valid order and query only their orders", async () => {
  const db = buyerDb();
  await assertSucceeds(setDoc(doc(db, "orders", "buyer-order"), order()));
  const result = await assertSucceeds(
    getDocs(query(collection(db, "orders"), where("customerUid", "==", BUYER_UID)))
  );
  if (result.size !== 1) throw new Error("Expected exactly one buyer order");
});

test("buyers cannot create orders for another account or tamper with validated fields", async () => {
  const db = buyerDb();
  await assertFails(setDoc(doc(db, "orders", "wrong-owner"), order({ customerUid: OTHER_UID })));
  await assertFails(setDoc(doc(db, "orders", "bad-player-uid"), order({ uid: "player123" })));
  await assertFails(setDoc(doc(db, "orders", "wrong-price"), order({ total: 1 })));
  await assertFails(setDoc(doc(db, "orders", "wrong-status"), order({ status: "Completed" })));
  await assertFails(setDoc(doc(db, "orders", "extra-field"), order({ isAdmin: true })));
});

test("buyers cannot read another buyer's order or update/delete their own order", async () => {
  const otherDb = buyerDb(OTHER_UID, "other@example.com");
  await assertSucceeds(setDoc(doc(otherDb, "orders", "other-order"), order({ customerUid: OTHER_UID })));

  const db = buyerDb();
  await assertSucceeds(setDoc(doc(db, "orders", "own-order"), order()));
  await assertFails(getDoc(doc(db, "orders", "other-order")));
  await assertFails(updateDoc(doc(db, "orders", "other-order"), { status: "Completed" }));
  await assertFails(deleteDoc(doc(db, "orders", "other-order")));
  await assertFails(updateDoc(doc(db, "orders", "own-order"), { status: "Completed" }));
  await assertFails(deleteDoc(doc(db, "orders", "own-order")));
});

test("admin can read all orders and update/delete order records", async () => {
  const db = buyerDb();
  await assertSucceeds(setDoc(doc(db, "orders", "admin-test-order"), order()));

  const admin = adminDb();
  const result = await assertSucceeds(getDocs(collection(admin, "orders")));
  if (result.size !== 1) throw new Error("Expected admin to read all orders");
  await assertSucceeds(updateDoc(doc(admin, "orders", "admin-test-order"), { status: "Processing" }));
  await assertSucceeds(deleteDoc(doc(admin, "orders", "admin-test-order")));
});

test("customer profiles are private and can only be created/updated by their owner", async () => {
  const db = buyerDb(BUYER_UID, "buyer@example.com");
  await assertSucceeds(setDoc(doc(db, "customers", BUYER_UID), {
    uid: BUYER_UID,
    name: "Buyer",
    email: "buyer@example.com",
    createdAt: serverTimestamp()
  }));

  await assertSucceeds(getDoc(doc(db, "customers", BUYER_UID)));
  await assertFails(getDoc(doc(db, "customers", OTHER_UID)));
  await assertSucceeds(updateDoc(doc(db, "customers", BUYER_UID), { name: "Buyer Updated" }));
  await assertFails(updateDoc(doc(db, "customers", BUYER_UID), { email: "attacker@example.com" }));
  await assertFails(deleteDoc(doc(db, "customers", BUYER_UID)));
});

test("public top-up activity is readable publicly but writable only by admin", async () => {
  const admin = adminDb();
  await assertSucceeds(setDoc(doc(admin, "publicTopUps", "completed-order"), {
    package: "50 Diamonds",
    total: 64,
    status: "success",
    verified: true,
    completedAt: serverTimestamp()
  }));

  const guest = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(guest, "publicTopUps", "completed-order")));
  await assertFails(setDoc(doc(buyerDb(), "publicTopUps", "fake-topup"), {
    package: "7500 Diamonds",
    total: 7700,
    status: "success",
    verified: true,
    completedAt: serverTimestamp()
  }));
});
