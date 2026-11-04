// State of the snapshot store (#12), shared by the host and the snapshots card. No vscode import.
// Change only by adding optional fields.
export interface SnapshotsState {
  /** Records kept in the store. */
  records: number;
  /** Sessions currently listed only because their source is gone. */
  fromSnapshot: number;
  /** Size of the store file in bytes; 0 while no file exists. */
  bytes: number;
  /** Cap from copilotHarness.snapshots.maxMegabytes, in bytes. */
  maxBytes: number;
  /** Records removed by the cap since the store was created, and when it last happened (ISO 8601). */
  trimmedTotal: number;
  trimmedAt?: string;
  /** False while no Copilot data was found: the store is not created then. */
  created: boolean;
}
