# Good and Bad Tests

## Good Tests

**Integration-style**: Test through real interfaces, not mocks of internal parts.

```text
// GOOD: Tests observable behavior
test "user can checkout with valid cart":
  cart = create_cart()
  cart.add(product)
  result = checkout(cart, payment_method)
  assert result.status == "confirmed"
```

Characteristics:

- Tests behavior users/callers care about
- Uses public API only
- Survives internal refactors
- Describes WHAT, not HOW
- One logical assertion per test

## Bad Tests

**Implementation-detail tests**: Coupled to internal structure.

```text
// BAD: Tests implementation details
test "checkout calls payment service internals":
  payment_spy = spy(payment_service)
  checkout(cart, payment_spy)
  assert payment_spy.process_called_with(cart.total)
```

Red flags:

- Mocking internal collaborators
- Testing private methods
- Asserting on call counts/order
- Test breaks when refactoring without behavior change
- Test name describes HOW not WHAT
- Verifying through external means instead of interface

```text
// BAD: Bypasses interface to verify
test "create_user saves to database":
  create_user(name="Alice")
  row = db.query("SELECT * FROM users WHERE name = ?", ["Alice"])
  assert row is not null

// GOOD: Verifies through interface
test "create_user makes user retrievable":
  user = create_user(name="Alice")
  retrieved = get_user(user.id)
  assert retrieved.name == "Alice"
```

## What NOT to Test

**Test at system boundaries, not internal modules.** A system has two boundaries:

1. **Server/backend boundary**: Test through the real runtime or framework test harness (HTTP requests, WebSocket messages, queue handlers). Exercise real storage, real state, real protocol handling.
2. **Client/frontend boundary**: Test at the route/page level with external dependencies mocked at the edge (e.g., mock the network layer, not your own stores or hooks).

Tests at these two levels cover your internal modules (stores, hooks, services, helpers) transitively. If a store has a bug, a route-level test that exercises the store's behavior will catch it.

**Do not write separate tests for:**

- **State management** (stores, reducers, state machines) — covered by route/page tests that trigger the same state transitions through user interactions
- **Custom hooks / composables** — covered by route/page tests that use the hook through a real component
- **Individual UI components** — covered by route/page tests that render the full page including those components
- **Config files** (CI workflows, bundler config, deploy config) — not behavioral; breaks when config format changes, catches nothing useful
- **Design tokens / CSS classes** — testing class name presence doesn't verify visual fidelity; either trust the design system or use visual regression tools

**Do write separate unit tests for:**

- **Pure algorithmic functions** where the math matters (rounding, scoring, splitting, fuzzy matching, validation logic). These have complex edge cases that are cheaper to test in isolation.

```text
// BAD: Testing internal state management separately
test "store updates count on increment message":
  store = create_store()
  store.handle_message({ type: "increment" })
  assert store.state.count == 1

// GOOD: Testing the same behavior through the UI boundary
test "user sees updated count after server sends increment":
  render(CounterPage, { websocket: mock_ws })
  mock_ws.receive({ type: "increment" })
  assert screen.has_text("Count: 1")

// GOOD: Pure algorithm deserves its own unit test
test "proportional split rounds to exact total using largest-remainder":
  result = split_proportional(total=100, weights=[1, 1, 1])
  assert sum(result) == 100
  assert result == [34, 33, 33]
```
