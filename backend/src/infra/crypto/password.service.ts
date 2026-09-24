import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Hash de senhas com Argon2id (recomendação OWASP). Senhas nunca são armazenadas em texto puro. */
@Injectable()
export class PasswordService {
  private readonly options: argon2.HashOptions & { raw?: false } = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  };

  hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) return false;
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /**
   * Hash fictício usado quando o usuário não existe, para que o tempo de resposta
   * do login não revele se o e-mail está cadastrado (enumeração de contas).
   */
  private dummyHash?: Promise<string>;

  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('senha-ficticia-para-tempo-constante');
    await this.verify(await this.dummyHash, password);
  }
}
