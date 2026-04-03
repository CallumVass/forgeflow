# When to Mock

Mock at **system boundaries** only:

- External APIs (payment, email, etc.)
- Databases (sometimes - prefer test DB)
- Time/randomness
- File system (sometimes)

Don't mock:

- Your own classes/modules
- Internal collaborators
- Anything you control

## Designing for Mockability

At system boundaries, design interfaces that are easy to mock:

**1. Use dependency injection**

Pass external dependencies in rather than creating them internally:

```text
// Easy to mock
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Hard to mock
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. Prefer SDK-style interfaces over generic fetchers**

Create specific functions for each external operation instead of one generic function with conditional logic:

```text
// GOOD: Each function is independently mockable
api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
}

// BAD: Mocking requires conditional logic inside the mock
api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
}
```

The SDK approach means:
- Each mock returns one specific shape
- No conditional logic in test setup
- Easier to see which endpoints a test exercises
- Stronger contracts per endpoint (typed or documented)

## The Boundary Rule

Your system has boundaries — edges where your code talks to something you don't control. Mock **at** those edges, never inside.

Examples of boundaries (mock these):
- Network calls (HTTP, WebSocket, gRPC) from client to server
- External service SDKs (payment, email, auth providers)
- Databases when a test DB isn't practical (prefer real test DBs)
- Time, randomness, filesystem

Examples of internals (never mock these):
- Your own stores, reducers, or state management
- Your own hooks, composables, or services
- Your own utility/helper modules
- Internal class collaborators

**If you're mocking something you wrote, you're testing implementation, not behavior.** The test will break on refactor and catch nothing real.

## Mock Fidelity

Mocks lie. Every mock encodes assumptions about external behavior. When those assumptions are wrong, tests pass but the app breaks.

**After writing tests with mocks, verify mock fidelity:**
- Does your mock return the same data shapes the real system returns?
- Does your mock follow the same timing/ordering the real system follows?
- Write at least one test against the real system (or realistic test double) per mocked boundary.
