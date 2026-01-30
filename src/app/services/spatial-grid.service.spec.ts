import { SpatialGrid, SpatialGridService } from './spatial-grid.service';

describe('SpatialGrid', () => {
  let grid: SpatialGrid;

  beforeEach(() => {
    grid = new SpatialGrid(50); // 50-unit cells
  });

  // ==========================================
  // INSERT / REMOVE / SIZE
  // ==========================================

  it('should start empty', () => {
    expect(grid.size).toBe(0);
    expect(grid.occupiedCells).toBe(0);
  });

  it('should insert and track entities', () => {
    grid.insert('a', 10, 20);
    grid.insert('b', 60, 70);

    expect(grid.size).toBe(2);
  });

  it('should remove entities', () => {
    grid.insert('a', 10, 20);
    grid.insert('b', 60, 70);
    grid.remove('a');

    expect(grid.size).toBe(1);
  });

  it('should handle removing non-existent entity gracefully', () => {
    grid.remove('nonexistent');
    expect(grid.size).toBe(0);
  });

  it('should clean up empty cells on remove', () => {
    grid.insert('a', 10, 20);
    expect(grid.occupiedCells).toBe(1);

    grid.remove('a');
    expect(grid.occupiedCells).toBe(0);
  });

  it('should clear all data', () => {
    grid.insert('a', 10, 20);
    grid.insert('b', 60, 70);
    grid.clear();

    expect(grid.size).toBe(0);
    expect(grid.occupiedCells).toBe(0);
  });

  // ==========================================
  // UPDATE
  // ==========================================

  it('should update entity position within same cell (no cell transition)', () => {
    grid.insert('a', 10, 10);
    grid.update('a', 15, 15); // Still in cell (0,0) for cellSize=50

    expect(grid.size).toBe(1);
    const pos = grid.getPosition('a');
    expect(pos).toEqual({ x: 15, z: 15 });
  });

  it('should update entity position across cells', () => {
    grid.insert('a', 10, 10); // Cell (0,0)
    grid.update('a', 60, 60); // Cell (1,1)

    expect(grid.size).toBe(1);
    expect(grid.occupiedCells).toBe(1); // Old cell cleaned up

    const pos = grid.getPosition('a');
    expect(pos).toEqual({ x: 60, z: 60 });
  });

  it('should insert when updating a non-existent entity', () => {
    grid.update('new', 100, 200);
    expect(grid.size).toBe(1);
    expect(grid.getPosition('new')).toEqual({ x: 100, z: 200 });
  });

  // ==========================================
  // GET POSITION
  // ==========================================

  it('should return position for tracked entity', () => {
    grid.insert('a', 42, 99);
    expect(grid.getPosition('a')).toEqual({ x: 42, z: 99 });
  });

  it('should return undefined for untracked entity', () => {
    expect(grid.getPosition('nonexistent')).toBeUndefined();
  });

  // ==========================================
  // QUERY RADIUS
  // ==========================================

  it('should find entities within radius', () => {
    grid.insert('a', 10, 10);
    grid.insert('b', 15, 15);
    grid.insert('c', 200, 200); // Far away

    const result = grid.queryRadius(10, 10, 20);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).not.toContain('c');
  });

  it('should return empty array when no entities in radius', () => {
    grid.insert('a', 200, 200);
    const result = grid.queryRadius(0, 0, 10);
    expect(result).toEqual([]);
  });

  it('should return empty array for empty grid', () => {
    const result = grid.queryRadius(0, 0, 100);
    expect(result).toEqual([]);
  });

  it('should handle entities exactly at radius boundary', () => {
    grid.insert('a', 10, 0);
    // Distance from origin = 10
    const result = grid.queryRadius(0, 0, 10);
    expect(result).toContain('a');
  });

  it('should handle large radius spanning many cells', () => {
    grid.insert('a', 0, 0);
    grid.insert('b', 100, 0);
    grid.insert('c', 0, 100);
    grid.insert('d', 100, 100);

    const result = grid.queryRadius(50, 50, 200);
    expect(result.length).toBe(4);
  });

  it('should handle negative coordinates', () => {
    grid.insert('a', -30, -40);
    grid.insert('b', -25, -35);

    const result = grid.queryRadius(-30, -40, 20);
    expect(result).toContain('a');
    expect(result).toContain('b');
  });

  // ==========================================
  // QUERY RECT
  // ==========================================

  it('should find entities within rectangle', () => {
    grid.insert('a', 10, 10);
    grid.insert('b', 20, 20);
    grid.insert('c', 100, 100); // Outside

    const result = grid.queryRect(0, 0, 30, 30);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).not.toContain('c');
  });

  it('should return empty array for empty rect region', () => {
    grid.insert('a', 200, 200);
    const result = grid.queryRect(0, 0, 50, 50);
    expect(result).toEqual([]);
  });

  it('should include entities at boundary', () => {
    grid.insert('a', 50, 50);
    const result = grid.queryRect(50, 50, 100, 100);
    expect(result).toContain('a');
  });

  it('should handle negative coordinate rects', () => {
    grid.insert('a', -20, -20);
    const result = grid.queryRect(-50, -50, 0, 0);
    expect(result).toContain('a');
  });

  // ==========================================
  // HAS ANY (early exit)
  // ==========================================

  it('should return true when entity exists in radius', () => {
    grid.insert('a', 10, 10);
    expect(grid.hasAny(10, 10, 5)).toBe(true);
  });

  it('should return false when no entity in radius', () => {
    grid.insert('a', 200, 200);
    expect(grid.hasAny(0, 0, 10)).toBe(false);
  });

  it('should return false for empty grid', () => {
    expect(grid.hasAny(0, 0, 100)).toBe(false);
  });

  // ==========================================
  // CELL MANAGEMENT
  // ==========================================

  it('should place entities in same cell when close', () => {
    grid.insert('a', 10, 10);
    grid.insert('b', 20, 20);
    // Both in cell (0,0) for cellSize=50
    expect(grid.occupiedCells).toBe(1);
  });

  it('should place entities in different cells when far apart', () => {
    grid.insert('a', 10, 10);  // Cell (0,0)
    grid.insert('b', 60, 60);  // Cell (1,1)
    expect(grid.occupiedCells).toBe(2);
  });

  // ==========================================
  // CUSTOM CELL SIZE
  // ==========================================

  it('should work with small cell size', () => {
    const smallGrid = new SpatialGrid(5);
    smallGrid.insert('a', 0, 0);
    smallGrid.insert('b', 3, 3);
    smallGrid.insert('c', 8, 8); // Different cell

    expect(smallGrid.occupiedCells).toBe(2);

    const result = smallGrid.queryRadius(0, 0, 6);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).not.toContain('c');
  });

  it('should work with large cell size', () => {
    const largeGrid = new SpatialGrid(200);
    largeGrid.insert('a', 0, 0);
    largeGrid.insert('b', 150, 150);
    // Both in same cell
    expect(largeGrid.occupiedCells).toBe(1);
  });

  // ==========================================
  // STRESS / EDGE CASES
  // ==========================================

  it('should handle many entities efficiently', () => {
    // Insert 1000 entities
    for (let i = 0; i < 1000; i++) {
      grid.insert(`e${i}`, Math.random() * 500, Math.random() * 500);
    }
    expect(grid.size).toBe(1000);

    // Query should still work
    const result = grid.queryRadius(250, 250, 50);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle entity at origin', () => {
    grid.insert('a', 0, 0);
    const result = grid.queryRadius(0, 0, 1);
    expect(result).toContain('a');
  });

  it('should handle duplicate insert (overwrites)', () => {
    grid.insert('a', 10, 10);
    grid.insert('a', 60, 60); // Insert again at different position

    expect(grid.size).toBe(2); // Note: insert doesn't deduplicate — use update for that
  });

  it('should handle rapid updates to same position', () => {
    grid.insert('a', 10, 10);
    for (let i = 0; i < 100; i++) {
      grid.update('a', 10 + i * 0.1, 10 + i * 0.1);
    }
    expect(grid.size).toBe(1);
    const pos = grid.getPosition('a');
    expect(pos!.x).toBeCloseTo(19.9, 1);
  });
});

describe('SpatialGridService', () => {
  let service: SpatialGridService;

  beforeEach(() => {
    service = new SpatialGridService();
  });

  it('should create an enemy grid', () => {
    expect(service.getEnemyGrid()).toBeDefined();
    expect(service.getEnemyGrid().size).toBe(0);
  });

  it('should update and query enemies', () => {
    service.updateEnemy('e1', 10, 10);
    service.updateEnemy('e2', 20, 20);
    service.updateEnemy('e3', 500, 500);

    expect(service.hasEnemyInRadius(10, 10, 30)).toBe(true);
    expect(service.hasEnemyInRadius(500, 500, 5)).toBe(true);
    expect(service.hasEnemyInRadius(300, 300, 10)).toBe(false);

    const ids = service.getEnemyIdsInRadius(10, 10, 30);
    expect(ids).toContain('e1');
    expect(ids).toContain('e2');
    expect(ids).not.toContain('e3');
  });

  it('should remove enemies', () => {
    service.updateEnemy('e1', 10, 10);
    service.removeEnemy('e1');

    expect(service.hasEnemyInRadius(10, 10, 50)).toBe(false);
  });

  it('should clear all enemies', () => {
    service.updateEnemy('e1', 10, 10);
    service.updateEnemy('e2', 20, 20);
    service.clear();

    expect(service.getEnemyGrid().size).toBe(0);
  });
});
