import {
  applyFilletToTree,
  applyExtrudeToTree,
  applySweepToTree,
  applyBooleanOperationToTree,
  countOperationsOfType,
} from "../../src/scene-operations/feature-tree-operations";
import { FeatureNode } from "../../src/types/sketch-types";

describe("feature-tree-operations", () => {
  describe("applyFilletToTree", () => {
    it("should convert body node to fillet operation", () => {
      const tree: FeatureNode[] = [
        { id: "body1", type: "body", name: "Body 1", visible: true, elementId: "el-1" },
      ];

      const result = applyFilletToTree(tree, "el-1", "Fillet 1", "fillet");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("operation");
      expect(result[0].operationType).toBe("fillet");
      expect(result[0].name).toBe("Fillet 1");
      expect(result[0].elementId).toBe("el-1");
    });

    it("should convert body node to chamfer operation", () => {
      const tree: FeatureNode[] = [
        { id: "body1", type: "body", name: "Body 1", visible: true, elementId: "el-1" },
      ];

      const result = applyFilletToTree(tree, "el-1", "Chamfer 1", "chamfer");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("operation");
      expect(result[0].operationType).toBe("chamfer");
      expect(result[0].name).toBe("Chamfer 1");
    });

    it("should preserve other nodes unchanged", () => {
      const tree: FeatureNode[] = [
        { id: "body1", type: "body", name: "Body 1", visible: true, elementId: "el-1" },
        { id: "body2", type: "body", name: "Body 2", visible: true, elementId: "el-2" },
        { id: "body3", type: "body", name: "Body 3", visible: false, elementId: "el-3" },
      ];

      const result = applyFilletToTree(tree, "el-2", "Fillet 1", "fillet");

      expect(result).toHaveLength(3);
      // First node unchanged
      expect(result[0].type).toBe("body");
      expect(result[0].name).toBe("Body 1");
      // Second node converted
      expect(result[1].type).toBe("operation");
      expect(result[1].operationType).toBe("fillet");
      // Third node unchanged
      expect(result[2].type).toBe("body");
      expect(result[2].name).toBe("Body 3");
    });

    it("should find and update nested nodes inside folders", () => {
      const tree: FeatureNode[] = [
        {
          id: "sketch1",
          type: "sketch",
          name: "Sketch 1",
          visible: true,
          expanded: true,
          children: [
            { id: "profile1", type: "body", name: "Profile 1", visible: true, elementId: "el-nested" },
          ],
        },
      ];

      const result = applyFilletToTree(tree, "el-nested", "Chamfer 1", "chamfer");

      expect(result[0].children).toHaveLength(1);
      expect(result[0].children![0].type).toBe("operation");
      expect(result[0].children![0].operationType).toBe("chamfer");
      expect(result[0].children![0].name).toBe("Chamfer 1");
    });

    it("should return tree unchanged when elementId not found", () => {
      const tree: FeatureNode[] = [
        { id: "body1", type: "body", name: "Body 1", visible: true, elementId: "el-1" },
      ];

      const result = applyFilletToTree(tree, "el-nonexistent", "Fillet 1", "fillet");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("body");
      expect(result[0].name).toBe("Body 1");
    });
  });

  describe("countOperationsOfType", () => {
    it("should count fillet operations", () => {
      const tree: FeatureNode[] = [
        { id: "op1", type: "operation", name: "Fillet 1", visible: true, operationType: "fillet", elementId: "el-1" },
        { id: "op2", type: "operation", name: "Chamfer 1", visible: true, operationType: "chamfer", elementId: "el-2" },
        { id: "op3", type: "operation", name: "Fillet 2", visible: true, operationType: "fillet", elementId: "el-3" },
      ];

      expect(countOperationsOfType(tree, "fillet")).toBe(2);
    });

    it("should count chamfer operations", () => {
      const tree: FeatureNode[] = [
        { id: "op1", type: "operation", name: "Fillet 1", visible: true, operationType: "fillet", elementId: "el-1" },
        { id: "op2", type: "operation", name: "Chamfer 1", visible: true, operationType: "chamfer", elementId: "el-2" },
        { id: "op3", type: "operation", name: "Fillet 2", visible: true, operationType: "fillet", elementId: "el-3" },
      ];

      expect(countOperationsOfType(tree, "chamfer")).toBe(1);
    });

    it("should count each operation type independently in mixed tree", () => {
      const tree: FeatureNode[] = [
        { id: "op1", type: "operation", name: "Extrude 1", visible: true, operationType: "extrude", elementId: "el-1" },
        { id: "op2", type: "operation", name: "Fillet 1", visible: true, operationType: "fillet", elementId: "el-2" },
        { id: "op3", type: "operation", name: "Union 1", visible: true, operationType: "union", elementId: "el-3" },
        { id: "op4", type: "operation", name: "Chamfer 1", visible: true, operationType: "chamfer", elementId: "el-4" },
      ];

      expect(countOperationsOfType(tree, "extrude")).toBe(1);
      expect(countOperationsOfType(tree, "fillet")).toBe(1);
      expect(countOperationsOfType(tree, "union")).toBe(1);
      expect(countOperationsOfType(tree, "chamfer")).toBe(1);
      expect(countOperationsOfType(tree, "difference")).toBe(0);
    });

    it("should count nested operations inside children", () => {
      const tree: FeatureNode[] = [
        {
          id: "sketch1",
          type: "sketch",
          name: "Sketch 1",
          visible: true,
          children: [
            { id: "op1", type: "operation", name: "Fillet 1", visible: true, operationType: "fillet", elementId: "el-1" },
          ],
        },
        { id: "op2", type: "operation", name: "Fillet 2", visible: true, operationType: "fillet", elementId: "el-2" },
      ];

      expect(countOperationsOfType(tree, "fillet")).toBe(2);
    });
  });

  describe("applySweepToTree", () => {
    it("should convert profile node to sweep operation and remove path node", () => {
      const tree: FeatureNode[] = [
        { id: "body1", type: "body", name: "Profile 1", visible: true, elementId: "el-profile" },
        { id: "body2", type: "body", name: "Path 1", visible: true, elementId: "el-path" },
      ];

      const result = applySweepToTree(tree, "el-profile", "el-path", "Sweep 1");

      // Path node removed, profile node converted to sweep operation
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("operation");
      expect(result[0].operationType).toBe("sweep");
      expect(result[0].name).toBe("Sweep 1");
      expect(result[0].elementId).toBe("el-profile");
    });

    it("should preserve other nodes unchanged", () => {
      const tree: FeatureNode[] = [
        { id: "body0", type: "body", name: "Other", visible: true, elementId: "el-other" },
        { id: "body1", type: "body", name: "Profile 1", visible: true, elementId: "el-profile" },
        { id: "body2", type: "body", name: "Path 1", visible: true, elementId: "el-path" },
      ];

      const result = applySweepToTree(tree, "el-profile", "el-path", "Sweep 1");

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Other");
      expect(result[0].type).toBe("body");
      expect(result[1].name).toBe("Sweep 1");
      expect(result[1].type).toBe("operation");
    });

    it("should handle nested profile and path nodes", () => {
      const tree: FeatureNode[] = [
        {
          id: "sketch1",
          type: "sketch",
          name: "Sketch 1",
          visible: true,
          children: [
            { id: "body1", type: "body", name: "Profile", visible: true, elementId: "el-profile" },
            { id: "body2", type: "body", name: "Path", visible: true, elementId: "el-path" },
          ],
        },
      ];

      const result = applySweepToTree(tree, "el-profile", "el-path", "Sweep 1");

      // Path removed from children, profile converted
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children![0].type).toBe("operation");
      expect(result[0].children![0].operationType).toBe("sweep");
    });
  });

  describe("applyBooleanOperationToTree (for loft)", () => {
    it("should consume profile nodes and create loft operation node", () => {
      const tree: FeatureNode[] = [
        { id: "body1", type: "body", name: "Profile 1", visible: true, elementId: "el-1" },
        { id: "body2", type: "body", name: "Profile 2", visible: true, elementId: "el-2" },
      ];

      const result = applyBooleanOperationToTree(
        tree, ["el-1", "el-2"], "el-loft", "loft", "Loft 1",
      );

      // Both profiles removed, new loft operation node added
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("operation");
      expect(result[0].operationType).toBe("loft");
      expect(result[0].name).toBe("Loft 1");
      expect(result[0].elementId).toBe("el-loft");
      // Original nodes stored as children
      expect(result[0].children).toHaveLength(2);
      expect(result[0].children![0].elementId).toBe("el-1");
      expect(result[0].children![1].elementId).toBe("el-2");
    });

    it("should preserve unrelated nodes when creating loft", () => {
      const tree: FeatureNode[] = [
        { id: "body0", type: "body", name: "Untouched", visible: true, elementId: "el-0" },
        { id: "body1", type: "body", name: "Profile 1", visible: true, elementId: "el-1" },
        { id: "body2", type: "body", name: "Profile 2", visible: true, elementId: "el-2" },
      ];

      const result = applyBooleanOperationToTree(
        tree, ["el-1", "el-2"], "el-loft", "loft", "Loft 1",
      );

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Untouched");
      expect(result[1].name).toBe("Loft 1");
    });

    it("should handle 3 profiles consumed in loft", () => {
      const tree: FeatureNode[] = [
        { id: "body1", type: "body", name: "P1", visible: true, elementId: "el-1" },
        { id: "body2", type: "body", name: "P2", visible: true, elementId: "el-2" },
        { id: "body3", type: "body", name: "P3", visible: true, elementId: "el-3" },
      ];

      const result = applyBooleanOperationToTree(
        tree, ["el-1", "el-2", "el-3"], "el-loft", "loft", "Loft 1",
      );

      expect(result).toHaveLength(1);
      expect(result[0].children).toHaveLength(3);
    });
  });

  describe("countOperationsOfType (sweep/loft)", () => {
    it("should count sweep operations", () => {
      const tree: FeatureNode[] = [
        { id: "op1", type: "operation", name: "Sweep 1", visible: true, operationType: "sweep", elementId: "el-1" },
        { id: "op2", type: "operation", name: "Extrude 1", visible: true, operationType: "extrude", elementId: "el-2" },
        { id: "op3", type: "operation", name: "Sweep 2", visible: true, operationType: "sweep", elementId: "el-3" },
      ];

      expect(countOperationsOfType(tree, "sweep")).toBe(2);
    });

    it("should count loft operations", () => {
      const tree: FeatureNode[] = [
        { id: "op1", type: "operation", name: "Loft 1", visible: true, operationType: "loft", elementId: "el-1" },
      ];

      expect(countOperationsOfType(tree, "loft")).toBe(1);
    });
  });

  describe("applyExtrudeToTree (regression)", () => {
    it("should still convert profile node to extrude operation", () => {
      const tree: FeatureNode[] = [
        { id: "body1", type: "profile", name: "Profile 1", visible: true, elementId: "el-1" },
      ];

      const result = applyExtrudeToTree(tree, "el-1", "Extrude 1");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("operation");
      expect(result[0].operationType).toBe("extrude");
      expect(result[0].name).toBe("Extrude 1");
      expect(result[0].elementId).toBe("el-1");
    });
  });
});
