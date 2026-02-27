import type { OpenCascadeInstance, TopoDS_Shape } from "opencascade.js";
import { Brep } from "../geometry";
import * as THREE from "three";
import { OpenCascadeService } from "./OpenCascadeService";
import { SceneElement } from "../scene-operations/types";

export interface ImportResult {
  brep: Brep;
  position: THREE.Vector3;
}

export class ImportExportService {
  private static instance: ImportExportService;
  private occService: OpenCascadeService;

  private constructor() {
    this.occService = OpenCascadeService.getInstance();
  }

  static getInstance(): ImportExportService {
    if (!ImportExportService.instance) {
      ImportExportService.instance = new ImportExportService();
    }
    return ImportExportService.instance;
  }

  private async buildCompoundFromElements(
    elements: SceneElement[],
  ): Promise<TopoDS_Shape> {
    const oc = await this.occService.getOC();
    const builder = new oc.BRep_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);

    for (const el of elements) {
      const shape = await this.occService.brepToOCShape(el.brep, el.position);
      builder.Add(compound, shape);
    }

    return compound;
  }

  // ── Export methods ──────────────────────────────────────────────────

  async exportSTEP(elements: SceneElement[]): Promise<Blob> {
    const oc = await this.occService.getOC();
    const compound = await this.buildCompoundFromElements(elements);
    const filePath = "/tmp/export.step";

    const writer = new oc.STEPControl_Writer_1();
    const progress = new oc.Message_ProgressRange_1();

    const transferStatus = writer.Transfer(
      compound,
      oc.STEPControl_StepModelType.STEPControl_AsIs as any,
      true,
      progress,
    );

    if (transferStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      writer.delete();
      progress.delete();
      throw new Error("STEP export: Transfer failed");
    }

    const writeStatus = writer.Write(filePath);
    if (writeStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      writer.delete();
      progress.delete();
      throw new Error("STEP export: Write failed");
    }

    const fileData = oc.FS.readFile(filePath);
    oc.FS.unlink(filePath);
    writer.delete();
    progress.delete();

    return new Blob([fileData], { type: "application/step" });
  }

  async exportSTL(elements: SceneElement[]): Promise<Blob> {
    const oc = await this.occService.getOC();
    const compound = await this.buildCompoundFromElements(elements);
    const filePath = "/tmp/export.stl";

    // Tessellate before STL export
    new oc.BRepMesh_IncrementalMesh_2(compound, 0.01, false, 0.1, false);

    const writer = new oc.StlAPI_Writer();
    const progress = new oc.Message_ProgressRange_1();
    const success = writer.Write(compound, filePath, progress);

    if (!success) {
      writer.delete();
      progress.delete();
      throw new Error("STL export: Write failed");
    }

    const fileData = oc.FS.readFile(filePath);
    oc.FS.unlink(filePath);
    writer.delete();
    progress.delete();

    return new Blob([fileData], { type: "model/stl" });
  }

  async exportIGES(elements: SceneElement[]): Promise<Blob> {
    const oc = await this.occService.getOC();
    const compound = await this.buildCompoundFromElements(elements);
    const filePath = "/tmp/export.iges";

    const writer = new oc.IGESControl_Writer_1();
    const progress = new oc.Message_ProgressRange_1();
    writer.AddShape(compound, progress);
    writer.ComputeModel();
    writer.Write_2(filePath, false);

    const fileData = oc.FS.readFile(filePath);
    oc.FS.unlink(filePath);
    writer.delete();
    progress.delete();

    return new Blob([fileData], { type: "application/iges" });
  }

  // ── Import methods ──────────────────────────────────────────────────

  async importSTEP(arrayBuffer: ArrayBuffer): Promise<ImportResult[]> {
    const oc = await this.occService.getOC();
    const filePath = "/tmp/import.step";

    oc.FS.writeFile(filePath, new Uint8Array(arrayBuffer));

    const reader = new oc.STEPControl_Reader_1();
    const readStatus = reader.ReadFile(filePath);

    if (readStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      reader.delete();
      oc.FS.unlink(filePath);
      throw new Error("STEP import: ReadFile failed");
    }

    const progress = new oc.Message_ProgressRange_1();
    reader.TransferRoots(progress);

    const results = await this.extractShapes(oc, reader);

    reader.delete();
    progress.delete();
    oc.FS.unlink(filePath);

    return results;
  }

  async importSTL(arrayBuffer: ArrayBuffer): Promise<ImportResult[]> {
    const oc = await this.occService.getOC();
    const filePath = "/tmp/import.stl";

    oc.FS.writeFile(filePath, new Uint8Array(arrayBuffer));

    const reader = new oc.StlAPI_Reader();
    const shape = new oc.TopoDS_Shape();
    const success = reader.Read(shape, filePath);

    if (!success) {
      reader.delete();
      shape.delete();
      oc.FS.unlink(filePath);
      throw new Error("STL import: Read failed");
    }

    // STL is a mesh format with no concept of separate objects —
    // importing as a single element is the correct behavior.
    const position = this.computeBoundingBoxCenter(oc, shape);
    const brep = await this.occService.ocShapeToBRep(shape, true);

    reader.delete();
    oc.FS.unlink(filePath);

    return [{ brep, position }];
  }

  private async decomposeShape(
    oc: OpenCascadeInstance,
    shape: TopoDS_Shape,
  ): Promise<ImportResult[]> {
    const results: ImportResult[] = [];

    if (shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_COMPOUND) {
      // Only decompose the top-level compound — each direct child is one element.
      // Do NOT recurse: children may themselves be compounds (e.g. tessellated
      // shapes are compounds of face triangles) and should stay as single elements.
      const iterator = new oc.TopoDS_Iterator_2(shape, true, true);
      while (iterator.More()) {
        const child = iterator.Value();
        const position = this.computeBoundingBoxCenter(oc, child);
        const brep = await this.occService.ocShapeToBRep(child, true);
        results.push({ brep, position });
        iterator.Next();
      }
      iterator.delete();

      if (results.length === 0) {
        const position = this.computeBoundingBoxCenter(oc, shape);
        const brep = await this.occService.ocShapeToBRep(shape, true);
        results.push({ brep, position });
      }
    } else {
      const position = this.computeBoundingBoxCenter(oc, shape);
      const brep = await this.occService.ocShapeToBRep(shape, true);
      results.push({ brep, position });
    }

    return results;
  }

  private computeBoundingBoxCenter(
    oc: OpenCascadeInstance,
    shape: TopoDS_Shape,
  ): THREE.Vector3 {
    const bBox = new oc.Bnd_Box_1();
    oc.BRepBndLib.Add(shape, bBox, false);

    const position = new THREE.Vector3(
      (bBox.CornerMin().X() + bBox.CornerMax().X()) / 2,
      (bBox.CornerMin().Y() + bBox.CornerMax().Y()) / 2,
      (bBox.CornerMin().Z() + bBox.CornerMax().Z()) / 2,
    );

    bBox.delete();
    return position;
  }

  private async extractShapes(
    oc: OpenCascadeInstance,
    reader: { NbShapes: () => number; Shape: (num: number) => TopoDS_Shape; OneShape: () => TopoDS_Shape },
  ): Promise<ImportResult[]> {
    const nbShapes = reader.NbShapes();

    if (nbShapes === 0) {
      throw new Error("Import: No shapes found in file");
    }

    const results: ImportResult[] = [];

    if (nbShapes === 1) {
      const shape = reader.OneShape();
      const shapeResults = await this.decomposeShape(oc, shape);
      results.push(...shapeResults);
    } else {
      for (let i = 1; i <= nbShapes; i++) {
        const shape = reader.Shape(i);
        const shapeResults = await this.decomposeShape(oc, shape);
        results.push(...shapeResults);
      }
    }

    return results;
  }
}
