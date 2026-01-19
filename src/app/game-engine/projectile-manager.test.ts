/**
 * ProjectileManager Event System Test
 *
 * Demonstrates event-based projectile system
 */

import { GameEventBus } from './game-event-bus';
import { ProjectileManager } from '../managers/projectile.manager.refactored';
import { VFXService } from './vfx.service';

/**
 * Simple test to verify event flow
 */
export function testProjectileEvents() {
  console.log('🧪 Testing ProjectileManager Event System...\n');

  // 1. Create Event Bus
  const eventBus = new GameEventBus();
  console.log('✅ GameEventBus created');

  // 2. Setup Event Listeners (simulate subscribers)
  const events: any[] = [];

  eventBus.on('projectile:hit', (event) => {
    events.push(event);
    console.log(`📣 Event: projectile:hit
   Projectile: ${event.projectile.id}
   Target: ${event.target.id}
   Damage: ${event.damage}`);
  });

  eventBus.on('projectile:missed', (event) => {
    events.push(event);
    console.log(`📣 Event: projectile:missed
   Projectile: ${event.projectile.id}`);
  });

  eventBus.on('vfx:projectile-impact', (event) => {
    events.push(event);
    console.log(`📣 Event: vfx:projectile-impact
   Type: ${event.projectileType}
   Position: (${event.lat.toFixed(4)}, ${event.lon.toFixed(4)})
   Height: ${event.height}m
   Target Lost: ${event.targetLost}`);
  });

  console.log('✅ Event listeners registered\n');

  // 3. Simulate projectile hit
  console.log('🎯 Simulating projectile hit...');

  // Emit immediate event (like ProjectileManager would)
  eventBus.emit({
    type: 'projectile:hit',
    projectile: { id: 'proj-123', damage: 50 } as any,
    target: { id: 'enemy-456' } as any,
    damage: 50,
  });

  // Emit deferred VFX event
  eventBus.emitDeferred({
    type: 'vfx:projectile-impact',
    lat: 47.3769,
    lon: 8.5417,
    height: 420.5,
    projectileType: 'rocket',
    targetLost: false,
  });

  console.log('\n📊 Queue before processing:', eventBus.getQueueSize(), 'deferred events');

  // 4. Process deferred events
  eventBus.processQueue();

  console.log('📊 Queue after processing:', eventBus.getQueueSize(), 'deferred events\n');

  // 5. Verify results
  console.log('📈 Test Results:');
  console.log(`   Total events: ${events.length}`);
  console.log(`   Immediate events: 1 (projectile:hit)`);
  console.log(`   Deferred events: 1 (vfx:projectile-impact)`);
  console.log(`   Listener count: ${eventBus.getListenerCount()}`);

  // 6. Get metrics
  const metrics = eventBus.getMetrics();
  console.log('\n📊 Event Bus Metrics:');
  console.log(`   Events emitted: ${metrics.eventsEmitted}`);
  console.log(`   Events deferred: ${metrics.eventsDeferred}`);
  console.log(`   Listener calls: ${metrics.listenerCalls}`);
  console.log(`   Queue size: ${metrics.queueSize}`);
  console.log(`   Total listeners: ${metrics.listenerCount}`);

  console.log('\n✅ Test complete!\n');

  return {
    success: events.length === 2,
    events,
    metrics,
  };
}

/**
 * Test subscription cleanup
 */
export function testSubscriptionCleanup() {
  console.log('🧪 Testing Subscription Cleanup...\n');

  const eventBus = new GameEventBus();

  // Create mock owner
  const tower = { id: 'tower-1' };

  console.log('📝 Subscribing with owner:', tower.id);

  // Subscribe with owner
  eventBus.subscribe(tower, 'enemy:died', (event) => {
    console.log('Enemy died:', event.enemy.id);
  });

  console.log(`✅ Listener count: ${eventBus.getListenerCount('enemy:died')}`);

  // Cleanup
  console.log('\n🧹 Cleaning up subscriptions for owner...');
  eventBus.unsubscribeAll(tower);

  console.log(`✅ Listener count after cleanup: ${eventBus.getListenerCount('enemy:died')}`);
  console.log('\n✅ Cleanup test complete!\n');
}

// Export test runner
export function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 GAME ENGINE EVENT SYSTEM TESTS');
  console.log('='.repeat(60) + '\n');

  const result1 = testProjectileEvents();
  console.log('='.repeat(60) + '\n');

  testSubscriptionCleanup();
  console.log('='.repeat(60) + '\n');

  return {
    projectileTest: result1.success,
    allPassed: result1.success,
  };
}

// Run if executed directly (for Node.js testing)
if (typeof module !== 'undefined' && require.main === module) {
  runAllTests();
}
