# Node Beam SDK

This is the start of a fully functioning Javascript (actually, Typescript) SDK.
There are two distinct aims with this SDK

1. Tap into the large (and relatively underserved, by existing data processing
frameworks) community of javascript developers with a native SDK targeting this language.

1. Develop a new SDK which can serve both as a proof of concept and reference
that highlights the (relative) ease of porting Beam to new languages,
a differentiating feature of Beam and Dataflow.

To accomplish this, we lean heavily on the portability framework.
For example, we make heavy use of cross-language transforms,
in particular for IOs.
In addition, the direct runner is simply an extension of the worker suitable
for running on portable runners such as the ULR, which will directly transfer
to running on production runners such as Dataflow and Flink.
The target audience should hopefully not be put off by running other-language
code encapsulated in docker images.

## API

We generally try to apply the concepts from the Beam API in a Typescript
idiomatic way, but it should be noted that few of the initial developers
have extensive (if any) Javascript/Typescript development experience, so
feedback is greatly appreciated.

In addition, some notable departures are taken from the traditional SDKs:

* We take a "relational foundations" approach, where
[schema'd data](https://docs.google.com/document/d/1tnG2DPHZYbsomvihIpXruUmQ12pHGK0QIvXS1FOTgRc/edit#heading=h.puuotbien1gf)
is the primary way to interact with data, and we generally eschew the key-value
requiring transforms in favor of a more flexible approach naming fields or
expressions. Javascript's native Object is used as the row type.

* As part of being schema-first we also de-emphasize Coders as a first-class
concept in the SDK, relegating it to an advance feature used for interop.
Though we can infer schemas from individual elements, it is still TBD to
figure out if/how we can leverage the type system and/or function introspection
to regularly infer schemas at construction time. A fallback coder using BSON
encoding is used when we don't have sufficient type information.

* We have added additional methods to the PCollection object, notably `map`
and `flatmap`, [rather than only allowing apply](https://www.mail-archive.com/dev@beam.apache.org/msg06035.html).
In addition, `apply` can accept a function argument `(PColletion) => ...` as
well as a PTransform subclass, which treats this callable as if it were a
PTransform's expand.

* In the other direction, we have eliminated the
[problematic Pipeline object](https://s.apache.org/no-beam-pipeline)
from the API, instead providing a `Root` PValue on which pipelines are built,
and invoking run() on a Runner.  We offer a less error-prone `Runner.run`
which finishes only when the pipeline is completely finished as well as
`Runner.runAsync` which returns a handle to the running pipeline.

* Rather than introduce PCollectionTuple, PCollectionList, etc. we let PValue
literally be an
[array or object with PValue values](https://github.com/robertwb/beam-javascript/blob/de4390dd767f046903ac23fead5db333290462db/sdks/node-ts/src/apache_beam/pvalue.ts#L116)
which transforms can consume or produce.
These are applied by wrapping them with the `P` operator, e.g.
`P([pc1, pc2, pc3]).apply(new Flatten())`.

* Like Python, `flatMap` and `ParDo.process` return multiple elements by
yielding them from a generator, rather than invoking a passed-in callback.
TBD how to output to multiple distinct PCollections.
There is currently an operation to split a PCollection into multiple
PCollections based on the properties of the elements, and
we may consider using a callback for side outputs.

* The `map`, `flatmap`, and `ParDo.proceess` methods take an additional
(optional) context argument, which is similar to the keyword arguments
used in Python. These can be "ordinary" javascript objects (which are passed
as is) or special DoFnParam objects which provide getters to element-specific
information (such as the current timestamp, window, or side input) at runtime.

* Javascript supports (and encourages) an asynchronous programing model, with
many libraries requiring use of the async/await paradigm.
As there is no way (by design) to go from the asyncronous style back to
the synchronous style, this needs to be taken into account
when designing the API.
We currently offer asynchronous variants of `PValue.apply(...)` (in addition
to the synchronous ones, as they are easier to chain) as well as making
`Runner.run` asynchronous. TBD to do this for all user callbacks as well.

An example pipeline can be found at https://github.com/robertwb/beam-javascript/blob/javascript/sdks/node-ts/src/apache_beam/examples/wordcount.ts

## TODO

This SDK is a work in progress. In January 2022 we developed the ability to
construct and run basic pipelines (including external transforms and running
on a portable runner) but the following big-ticket items remain.

* Containerization

  * Function and object serialization: we currently only support "loopback"
  mode; to be able to run on a remote, distributed manner we need to finish up
  the work in picking closures and DoFn objects. Some investigation has been
  started here, but all existing libraries have non-trivial drawbacks.

  * Finish the work in building a full SDK container image that starts
  the worker.

  * Actually use worker threads for multiple bundles.

* External transforms

  * Using external transforms requires that the external expansion service
  already be started and its address provided.  We would like to automatically
  start it as we do in Python.

* API

  * There are several TODOs of minor features or design decisions to finalize.

    * Consider using (or supporting) 2-arrays rather than {key, value} objects
      for KVs.

    * Consider renaming map/flatMap to doMap/doFlatMap to avoid confusion with
    Array.map that takes a key as a second callback argument.
    Or force the second argument to be an Object, which would lead to a less
    confusing API and clean up the implementation.
    Also add a [do]Filter, and possibly a [do]Reduce?

    * Move away from using classes.

  * Add the ability to set good PTransform names, and ideally infer good
  defaults.

  * Advanced features like metrics, state, timers, and SDF.
  Possibly some of these can wait.

  * PipelineOptions should be a Javascript Object, not a proto Struct.

* Infrastructure

  * Gradle and Jenkins integration for tests and style enforcement.

* Other

  * Standardize on a way for users to pass PTransform names, and enforce
  unique names for pipeline update.

  * Use a Javascript Object rather than proto Struct for pipeline options.

  * Though Dataflow Runner v2 supports portability, submission is still done
  via v1beta3 and interaction with GCS rather than the job submission API.

  * Cleanup uses of var, this. Arrow functions. `===` vs `==`.

  * Avoid any return types (and re-enable check in compiler).

  * Relative vs. absoute imports, possibly via setting a base url with a
  `jsconfig.json``.  Also remove imports from base.ts.

  * More/better tests, including tests of illegal/unsupported use.

  * Set channel options like `grpc.max_{send,receive}_message_length` as we
  do in other SDKs.

  * Reduce use of any.

    * Could use `unknown` in its place where the type is truly unknown.

    * It'd be nice to enforce, maybe re-enable `noImplicitAny: true` in
    tsconfig if we can get the generated proto files to be ignored.

  * Enable a linter like eslint and fix at least the low hanging fruit.

There is probably more; there are many TODOs littered throughout the code.

This code has also not yet been fully peer reviewed (it was the result of a
hackathon) which needs to be done before putting it into the man repository.


## Development.

### Getting stared

Install node.js, and then from within `sdks/node-ts`.

```
npm install
```

### Running tests

```
$  npm test
```

### Style

We have adopted prettier which can be run with

```
#  npx prettier --write .
```
