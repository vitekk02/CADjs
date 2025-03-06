import { Face, Vertex } from "../geometry";

export function createCubeBRep() {
  // Cube centered at origin with side length 2.
  const v0 = new Vertex(-1, -1, -1);
  const v1 = new Vertex(1, -1, -1);
  const v2 = new Vertex(1, 1, -1);
  const v3 = new Vertex(-1, 1, -1);
  const v4 = new Vertex(-1, -1, 1);
  const v5 = new Vertex(1, -1, 1);
  const v6 = new Vertex(1, 1, 1);
  const v7 = new Vertex(-1, 1, 1);

  // Define faces (vertices are ordered counter-clockwise as seen from the outside).
  const front = new Face([v4, v5, v6, v7]); // z = 1
  const back = new Face([v0, v1, v2, v3]); // z = -1
  const right = new Face([v1, v5, v6, v2]); // x = 1
  const left = new Face([v0, v4, v7, v3]); // x = -1
  const top = new Face([v3, v2, v6, v7]); // y = 1
  const bottom = new Face([v0, v1, v5, v4]); // y = -1

  return [front, back, right, left, top, bottom];
}
