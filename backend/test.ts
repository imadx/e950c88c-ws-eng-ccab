import { performance } from "perf_hooks";
import supertest from "supertest";
import { buildApp } from "./app";

const app = supertest(buildApp());

async function basicLatencyTest() {
    await app.post("/reset").expect(204);
    const start = performance.now();
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    console.log(`Latency: ${performance.now() - start} ms`);
}

async function testReset() {
    const response = await app.post('/reset').send({ account: 'test' });
    if (response.status !== 204) {
        throw new Error(`Expected status 204, but got ${response.status}`);
    }
}

async function testChargeSufficientBalance() {
    await app.post('/reset').send({ account: 'test' });
    const response = await app.post('/charge').send({ account: 'test', charges: 15 });
    if (response.status !== 200) {
        throw new Error(`Expected status 200, but got ${response.status}`);
    }
    const expectedBody = {
        isAuthorized: true,
        remainingBalance: 85,
        charges: 15
    };
    if (JSON.stringify(response.body) !== JSON.stringify(expectedBody)) {
        throw new Error(`Expected body ${JSON.stringify(expectedBody)}, but got ${JSON.stringify(response.body)}`);
    }
}

async function testChargeInsufficientBalance() {
    await app.post('/reset').send({ account: 'test' });
    const response = await app.post('/charge').send({ account: 'test', charges: 150 });
    if (response.status !== 200) {
        throw new Error(`Expected status 200, but got ${response.status}`);
    }
    const expectedBody = {
        isAuthorized: false,
        remainingBalance: 100,
        charges: 0
    };
    if (JSON.stringify(response.body) !== JSON.stringify(expectedBody)) {
        throw new Error(`Expected body ${JSON.stringify(expectedBody)}, but got ${JSON.stringify(response.body)}`);
    }
}

async function testConcurrentChargesSufficientBalance() {
    await app.post('/reset').send({ account: 'test' });
    const responses = await Promise.all([
        app.post('/charge').send({ account: 'test', charges: 50 }),
        app.post('/charge').send({ account: 'test', charges: 50 })
    ]);

    const authorizedResponses = responses.filter(res => res.body.isAuthorized);
    const unauthorizedResponses = responses.filter(res => !res.body.isAuthorized);

    if (authorizedResponses.length !== 2 || unauthorizedResponses.length !== 0) {
        throw new Error(`Expected 2 authorized and 0 unauthorized responses, but got ${authorizedResponses.length} authorized and ${unauthorizedResponses.length} unauthorized`);
    }
    if (authorizedResponses[0].body.remainingBalance !== 50 || authorizedResponses[1].body.remainingBalance !== 0) {
        throw new Error(`Expected remaining balances 50 and 0, but got ${authorizedResponses[0].body.remainingBalance} and ${authorizedResponses[1].body.remainingBalance}`);
    }
}

async function testConcurrentChargesCorrectlyInsufficientBalance() {
    await app.post('/reset').send({ account: 'test' });
    const responses = await Promise.all([
        app.post('/charge').send({ account: 'test', charges: 100 }),
        app.post('/charge').send({ account: 'test', charges: 100 })
    ]);

    const authorizedResponses = responses.filter(res => res.body.isAuthorized);
    const unauthorizedResponses = responses.filter(res => !res.body.isAuthorized);

    if (authorizedResponses.length !== 1 || unauthorizedResponses.length !== 1) {
        throw new Error(`Expected 1 authorized and 1 unauthorized response, but got ${authorizedResponses.length} authorized and ${unauthorizedResponses.length} unauthorized`);
    }
    if (authorizedResponses[0].body.remainingBalance !== 0 || unauthorizedResponses[0].body.remainingBalance !== 0) {
        throw new Error(`Expected remaining balances 0 and 0, but got ${authorizedResponses[0].body.remainingBalance} and ${unauthorizedResponses[0].body.remainingBalance}`);
    }
}

async function runTests() {
    await basicLatencyTest();
    await testReset();
    await testChargeSufficientBalance();
    await testChargeInsufficientBalance();
    await testConcurrentChargesSufficientBalance();
    await testConcurrentChargesCorrectlyInsufficientBalance();
    console.log("All tests passed");
}

runTests().catch(console.error);