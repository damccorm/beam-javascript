/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as grpc from "@grpc/grpc-js";

import { Elements } from "../proto/beam_fn_api";
import {
  ProcessBundleDescriptor,
  ProcessBundleResponse,
} from "../proto/beam_fn_api";
import {
  BeamFnDataClient,
  IBeamFnDataClient,
} from "../proto/beam_fn_api.grpc-client";

export class MultiplexingDataChannel {
  dataClient: BeamFnDataClient;
  dataChannel: grpc.ClientDuplexStream<Elements, Elements>;

  consumers: Map<string, Map<string, IDataChannel>> = new Map();

  constructor(endpoint: string, workerId: string) {
    const metadata = new grpc.Metadata();
    metadata.add("worker_id", workerId);
    this.dataClient = new BeamFnDataClient(
      endpoint,
      grpc.ChannelCredentials.createInsecure(),
      {},
      {}
    );
    this.dataChannel = this.dataClient.data(metadata);
    this.dataChannel.on("data", async (elements) => {
      console.log("data", elements);
      for (const data of elements.data) {
        const consumer = this.getConsumer(data.instructionId, data.transformId);
        try {
          await consumer.sendData(data.data);
          if (data.isLast) {
            consumer.close();
          }
        } catch (error) {
          consumer.onError(error);
        }
      }
      for (const timers of elements.timers) {
        const consumer = this.getConsumer(
          timers.instructionId,
          timers.transformId
        );
        try {
          await consumer.sendTimers(timers.timerFamilyId, timers.timers);
          if (timers.isLast) {
            consumer.close();
          }
        } catch (error) {
          consumer.onError(error);
        }
      }
    });
  }

  close() {
    this.dataChannel.end();
  }

  async registerConsumer(
    bundleId: string,
    transformId: string,
    consumer: IDataChannel
  ) {
    consumer = new TruncateOnErrorDataChannel(consumer);
    if (!this.consumers.has(bundleId)) {
      this.consumers.set(bundleId, new Map());
    }
    if (this.consumers.get(bundleId)!.has(transformId)) {
      await (
        this.consumers.get(bundleId)!.get(transformId) as BufferingDataChannel
      ).flush(consumer);
    }
    this.consumers.get(bundleId)!.set(transformId, consumer);
  }

  unregisterConsumer(bundleId: string, transformId: string) {
    this.consumers.get(bundleId)!.delete(transformId);
  }

  getConsumer(bundleId: string, transformId: string): IDataChannel {
    if (!this.consumers.has(bundleId)) {
      this.consumers.set(bundleId, new Map());
    }
    if (!this.consumers.get(bundleId)!.has(transformId)) {
      this.consumers
        .get(bundleId)!
        .set(transformId, new BufferingDataChannel());
    }
    return this.consumers.get(bundleId)!.get(transformId)!;
  }

  getSendChannel(bundleId: string, transformId: string): IDataChannel {
    // TODO: (Perf) Buffer and consilidate send requests?
    // Or perhaps document that consumers of this API should so so.
    const this_ = this;
    return {
      sendData: function (data: Uint8Array) {
        this_.dataChannel.write({
          data: [
            {
              instructionId: bundleId,
              transformId: transformId,
              data: data,
              isLast: false,
            },
          ],
          timers: [],
        });
        return Promise.resolve();
      },
      sendTimers: function (timerFamilyId: string, timers: Uint8Array) {
        // Should never get here if we never send timers.
        throw Error("Timers not yet supported.");
      },
      close: function () {
        this_.dataChannel.write({
          data: [
            {
              instructionId: bundleId,
              transformId: transformId,
              data: new Uint8Array(),
              isLast: true,
            },
          ],
          timers: [],
        });
      },
      onError: function (error: Error) {
        throw error;
      },
    };
  }
}

export interface IDataChannel {
  // TODO: (Naming) onData?
  sendData: (data: Uint8Array) => Promise<void>;
  sendTimers: (timerFamilyId: string, timers: Uint8Array) => Promise<void>;
  close: () => void;
  onError: (Error) => void;
}

class BufferingDataChannel implements IDataChannel {
  data: Uint8Array[] = [];
  timers: [string, Uint8Array][] = [];
  closed: boolean = false;
  error?: Error;

  sendData(data: Uint8Array) {
    this.data.push(data);
    return Promise.resolve();
  }

  sendTimers(timerFamilyId: string, timers: Uint8Array) {
    this.timers.push([timerFamilyId, timers]);
    return Promise.resolve();
  }

  close() {
    this.closed = true;
  }

  onError(error: Error) {
    this.closed = true;
    this.error = error;
  }

  async flush(channel: IDataChannel) {
    for (const datum of this.data) {
      await channel.sendData(datum);
    }
    for (const [timerFamilyId, timers] of this.timers) {
      await channel.sendTimers(timerFamilyId, timers);
    }
    if (this.error) {
      channel.onError(this.error);
    }
    if (this.closed) {
      channel.close();
    }
  }
}

class TruncateOnErrorDataChannel implements IDataChannel {
  private seenError: boolean = false;

  constructor(private underlying: IDataChannel) {}

  sendData(data: Uint8Array) {
    if (this.seenError) {
      return Promise.resolve();
    }
    return this.underlying.sendData(data);
  }

  sendTimers(timerFamilyId: string, timers: Uint8Array) {
    if (this.seenError) {
      return Promise.resolve();
    }
    return this.underlying.sendTimers(timerFamilyId, timers);
  }

  close() {
    this.underlying.close();
  }

  onError(error: Error) {
    console.error("DATA ERROR", error);
    this.seenError = true;
    this.underlying.onError(error);
  }
}
