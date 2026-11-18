import { TestMutationGuardDto } from './update-test.dto';

/** TL-94/TL-98: publish is guarded by the test's current updatedAt. */
export class PublishTestDto extends TestMutationGuardDto {}
