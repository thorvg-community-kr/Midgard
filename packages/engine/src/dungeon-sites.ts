import { point } from './geometry';
import { f32, hash01 } from './numeric';
import { DungeonKind, Giant, Region, World, unsafeGround, isStone, isWater, type Dungeon, type TileCoord } from './world-types';
import type { WorldMap } from './world-map';
const titles = [
    ['Tower of Ravens', 'The Broken Hall', "Bifrost's Foot", 'Valgrind'],
    ['The Green Door', 'The Vanir Well', 'The Golden Glade', "Njord's Gate"],
    ['The Bright Gate', "Freyr's Glade", 'The Elfhame Door', 'Glimmering Rift'],
    ['Ironwood Den', 'Wargmaw', 'The Howling Cleft', 'Greyfang Hollow'],
    ["Dvalin's Door", 'The Deep Delving', "Brokk's Stair", 'The Forge Below'],
    ['The Mist Gate', 'Rime Rift', 'The Frozen Throat', 'The Weeping Gate'],
    ["Surt's Door", 'The Burning Hall', 'The Ember Gate', 'The Cinder Rift'],
    ['Barrow of Kings', 'The Drowned Howe', 'Draugmound', 'Gjallar Crossing'],
];
function fits(map: WorldMap, x: number, y: number, kind: DungeonKind, home: boolean): boolean {
    const giant = map.giant();
    if (giant && f32(x + 5) > giant.origin.x && f32(x - 3) < f32(giant.origin.x + Giant.size) && f32(y + 5) > giant.origin.y && f32(y - 3) < f32(giant.origin.y + Giant.size))
        return false;
    let rockNear = false;
    for (let dy = -1; dy <= 2; dy++)
        for (let dx = -1; dx <= 2; dx++) {
            if (!map.inside(f32(x + dx), f32(y + dy)))
                return false;
            const tile = map.at(f32(x + dx), f32(y + dy)), footprint = dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1;
            if (footprint && (isWater(tile.terrain) || unsafeGround(tile.terrain) || tile.dungeon >= 0))
                return false;
            const doorstep = dx === 1 && dy === 2;
            if (doorstep && (isWater(tile.terrain) || unsafeGround(tile.terrain)))
                return false;
            rockNear ||= isStone(tile.terrain);
        }
    return kind !== DungeonKind.Cave || rockNear || home;
}
function clearEntrance(map: WorldMap, at: TileCoord, index: number): void {
    for (let dy = -2; dy < 4; dy++)
        for (let dx = -2; dx < 4; dx++) {
            if (!map.inside(f32(at.x + dx), f32(at.y + dy)))
                continue;
            const tile = map.at(f32(at.x + dx), f32(at.y + dy));
            if (dx >= 0 && dx < 2 && dy >= 0 && dy < 2)
                tile.dungeon = index;
            tile.trees = tile.wild = 0;
        }
}
/** A sortie must be able to march home before the settlement has laid any bridges. */
function reachable(map: WorldMap, start: TileCoord): Uint8Array {
    const width = map.width(), height = map.height(), seen = new Uint8Array(width * height);
    const queue = [start.y * width + start.x];
    seen[queue[0]] = 1;
    const visit = (x: number, y: number): void => {
        if (!map.inside(x, y)) return;
        const index = y * width + x;
        if (seen[index]) return;
        const terrain = map.tiles[index].terrain;
        if (isWater(terrain) || unsafeGround(terrain)) return;
        seen[index] = 1;
        queue.push(index);
    };
    for (let i = 0; i < queue.length; ++i) {
        const cell = queue[i], x = cell % width, y = Math.floor(cell / width);
        visit(x + 1, y);
        visit(x - 1, y);
        visit(x, y + 1);
        visit(x, y - 1);
    }
    return seen;
}
export function placeDungeons(map: WorldMap, sites: Dungeon[], start: TileCoord): void {
    const reach = reachable(map, start), span = Math.min(map.width(), map.height());
    const outerDistance = Math.max(18, Math.min(38, span * .32));
    const gates = [[World.Jotunheim, DungeonKind.Cave], [World.Helheim, DungeonKind.Crypt], [World.Niflheim, DungeonKind.Portal], [World.Muspelheim, DungeonKind.Ruin], [World.Asgard, DungeonKind.Ruin], [World.Alfheim, DungeonKind.Portal], [World.Vanaheim, DungeonKind.Portal], [World.Svartalfheim, DungeonKind.Cave]] as const;
    for (let k = 0; k < gates.length; k++) {
        const [world, kind] = gates[k], home = k === 0;
        const preferredDistance = home ? 9 : Math.min(span * .58, k < 4 ? 48 : 73);
        let best = { x: -1, y: -1 }, bestScore = -Infinity;
        for (let y = 2; y < f32(map.height() - 3); y++)
            for (let x = 2; x < f32(map.width() - 3); x++) {
                const distance = Math.hypot(x + .5 - start.x, y + .5 - start.y);
                if ((home ? distance < 7 || distance > 11.5 : distance < outerDistance) ||
                    !reach[(y + 2) * map.width() + x + 1] || !fits(map, x, y, kind, home))
                    continue;
                if (map.destination({ name: '', kind, origin: { x, y }, discovered: false }) !== world)
                    continue;
                if (sites.some(d => f32(Math.hypot(f32(d.origin.x - x), f32(d.origin.y - y))) < 14))
                    continue;
                const giant = map.giant();
                if (!home && giant && giant.sights().some(s => f32(Math.hypot(f32(f32(s.center.x - x) - 1), f32(f32(s.center.y - y) - 1))) <= f32(s.radius + f32(1.5))))
                    continue;
                let score = hash01(map.seed(), x, y, 90 + k) - Math.abs(distance - preferredDistance) * .02;
                if (home && giant)
                    score = f32(score + f32(f32((f32(f32(f32(f32(f32(x + 1) - giant.center().x) + y) + 1) - giant.center().y)) * f32(.7071)) * f32(.03)));
                if (score > bestScore) {
                    bestScore = score;
                    best = { x, y };
                }
            }
        if (best.x < 0)
            continue;
        const names = titles[world];
        sites.push({ name: names[Math.trunc(f32(hash01(map.seed(), world, 3, 95) * names.length)) % names.length], kind, origin: best, discovered: false });
        clearEntrance(map, best, f32(sites.length - 1));
    }
    const halls = ['Eastshore Stone Hall', 'The Tideworn Hall'];
    for (let k = 0; k < (map.width() >= 128 ? 2 : 1); k++) {
        let best = { x: -1, y: -1 }, bestScore = -Infinity;
        for (let y = 2; y < f32(map.height() - 3); y++)
            for (let x = 2; x < f32(map.width() - 3); x++) {
                const door = point(f32(x + 1), f32(y + f32(2.3)));
                if (!map.onEasternCoast(door) || !fits(map, x, y, DungeonKind.GiantHall, false) || !reach[f32(f32(f32((f32(y + 2)) * map.width()) + x) + 1)])
                    continue;
                const distance = Math.hypot(x - start.x, y - start.y);
                if (distance < Math.min(18, span * .2))
                    continue;
                if (sites.some(d => f32(Math.hypot(f32(d.origin.x - x), f32(d.origin.y - y))) < Math.min(12, f32(map.width() / 10))))
                    continue;
                const shoreDistance = k === 0 ? Math.min(span * .25, 23) : outerDistance + 12;
                const score = hash01(map.seed(), x, y, 171 + k) + (map.regionAt(door) === Region.Middle ? 2 : 0)
                    - Math.abs(distance - shoreDistance) * (k === 0 ? .035 : .12);
                if (score > bestScore) {
                    bestScore = score;
                    best = { x, y };
                }
            }
        if (best.x < 0)
            continue;
        sites.push({ name: halls[k], kind: DungeonKind.GiantHall, origin: best, discovered: false });
        clearEntrance(map, best, f32(sites.length - 1));
    }
}
